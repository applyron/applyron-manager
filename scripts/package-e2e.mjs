import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { flipFuses, FuseV1Options, FuseVersion } from '@electron/fuses';
import { parseElectronApp } from 'electron-playwright-helpers';

const packageJsonPath = path.join(process.cwd(), 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const productName = packageJson.productName ?? packageJson.name;
const executableName =
  process.platform === 'win32'
    ? 'applyron-manager.exe'
    : process.platform === 'darwin'
      ? productName
      : packageJson.name;
const buildDirectoryName = `${productName}-${process.platform}-${process.arch}`;
const e2eBuildDirectory = path.join(process.cwd(), 'out', 'e2e');
const candidateBuildDirectories = [
  path.join(e2eBuildDirectory, buildDirectoryName),
  path.join(process.cwd(), 'out', buildDirectoryName),
];
const forgeCliPath = path.join(
  process.cwd(),
  'node_modules',
  '@electron-forge',
  'cli',
  'dist',
  'electron-forge.js',
);

function sleepSync(milliseconds) {
  if (milliseconds <= 0) {
    return;
  }

  if (process.platform === 'win32') {
    spawnSync(
      'powershell',
      ['-NoProfile', '-Command', `Start-Sleep -Milliseconds ${milliseconds}`],
      {
        stdio: 'ignore',
      },
    );
    return;
  }

  spawnSync(process.execPath, ['-e', `setTimeout(() => process.exit(0), ${milliseconds})`], {
    stdio: 'ignore',
  });
}

function cleanupLockedE2eProcesses() {
  if (process.platform !== 'win32') {
    return;
  }

  const executableCandidates = candidateBuildDirectories.map((buildDirectory) =>
    path.join(buildDirectory, executableName),
  );
  const filters = executableCandidates
    .map((executablePath) => {
      const escapedPath = executablePath.replace(/\\/g, '\\\\').replace(/'/g, "''");
      return `($_.ExecutablePath -eq '${escapedPath}')`;
    })
    .join(' -or ');

  if (!filters) {
    return;
  }

  spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process | Where-Object { ${filters} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    ],
    {
      stdio: 'ignore',
    },
  );

  spawnSync('taskkill', ['/IM', executableName, '/T', '/F'], {
    stdio: 'ignore',
  });
}

function removeDirectoryWithRetries(buildDirectory) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(buildDirectory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (process.platform !== 'win32' || attempt === 4) {
        throw error;
      }

      cleanupLockedE2eProcesses();
      sleepSync(400);
    }
  }
}

cleanupLockedE2eProcesses();
for (const buildDirectory of [e2eBuildDirectory, ...candidateBuildDirectories]) {
  removeDirectoryWithRetries(buildDirectory);
}

const child = spawn(process.execPath, [forgeCliPath, 'package'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    APPLYRON_E2E: '1',
  },
  stdio: 'inherit',
});

let finalized = false;
let readyChecks = 0;

function getRequiredRuntimeFiles(buildDirectory) {
  const appInfo = parseElectronApp(buildDirectory);
  return [appInfo.executable, appInfo.main, path.join(path.dirname(appInfo.main), 'preload.js')];
}

function getPackagedPaths(buildDirectory) {
  const appInfo = parseElectronApp(buildDirectory);
  return {
    executable: appInfo.executable,
    marker: path.dirname(appInfo.main),
  };
}

function getBuildReadiness(buildDirectory) {
  try {
    const packagedPaths = getPackagedPaths(buildDirectory);
    const requiredRuntimeFiles = getRequiredRuntimeFiles(buildDirectory);
    const missingPaths = [
      ...[packagedPaths.executable, packagedPaths.marker].filter(
        (targetPath) => !fs.existsSync(targetPath),
      ),
      ...requiredRuntimeFiles.filter((requiredPath) => !fs.existsSync(requiredPath)),
    ];

    return {
      ready: missingPaths.length === 0,
      missingPaths,
      parseError: null,
    };
  } catch (error) {
    return {
      ready: false,
      missingPaths: [],
      parseError: error,
    };
  }
}

function findReadyBuildDirectory() {
  return candidateBuildDirectories.find((buildDirectory) => {
    return getBuildReadiness(buildDirectory).ready;
  });
}

function isPackagedAppReady() {
  return Boolean(findReadyBuildDirectory());
}

async function killChildProcessTree(pid) {
  if (!pid) {
    return;
  }

  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
      });
      killer.once('close', () => resolve());
      killer.once('error', () => resolve());
    });
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Ignore missing process errors.
  }
}

async function finalizePackage(exitCode = 0) {
  if (finalized) {
    return;
  }

  finalized = true;
  clearInterval(readinessPoll);

  try {
    const readyBuildDirectory = findReadyBuildDirectory();
    if (readyBuildDirectory) {
      const packagedPaths = getPackagedPaths(readyBuildDirectory);
      await flipFuses(packagedPaths.executable, {
        version: FuseVersion.V1,
        [FuseV1Options.RunAsNode]: false,
        [FuseV1Options.EnableCookieEncryption]: true,
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
        [FuseV1Options.EnableNodeCliInspectArguments]: true,
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
        [FuseV1Options.OnlyLoadAppFromAsar]: false,
      });
    }
  } catch (error) {
    console.error('Failed to apply E2E fuses to packaged executable.');
    console.error(error);
    process.exit(1);
    return;
  }

  await killChildProcessTree(child.pid);
  process.exit(exitCode);
}

const readinessPoll = setInterval(() => {
  if (finalized) {
    return;
  }

  readyChecks = isPackagedAppReady() ? readyChecks + 1 : 0;
  if (readyChecks >= 3) {
    void finalizePackage(0);
  }
}, 2000);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  if (code === 0 && isPackagedAppReady()) {
    void finalizePackage(0);
    return;
  }

  if (code === 0) {
    for (const buildDirectory of candidateBuildDirectories) {
      const readiness = getBuildReadiness(buildDirectory);
      if (readiness.ready) {
        continue;
      }

      console.error(`[package:e2e] Build readiness failed for ${buildDirectory}`);
      if (readiness.parseError) {
        console.error(readiness.parseError);
        continue;
      }

      if (readiness.missingPaths.length > 0) {
        console.error('[package:e2e] Missing runtime paths:');
        for (const missingPath of readiness.missingPaths) {
          console.error(` - ${missingPath}`);
        }
      }
    }
    console.error(
      'E2E package completed without a ready packaged app. Required runtime files were missing.',
    );
  }

  if (!finalized) {
    finalized = true;
    clearInterval(readinessPoll);
    process.exit(code === 0 ? 1 : (code ?? 1));
  }
});
