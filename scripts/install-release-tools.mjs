import { existsSync, readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

const PACKAGE_VERSIONS = {
  '@electron-forge/maker-squirrel': '7.11.1',
  '@electron-forge/maker-wix': '7.11.1',
  '@electron-forge/maker-dmg': '7.11.1',
  '@electron-forge/maker-zip': '7.11.1',
  '@electron-forge/maker-deb': '7.11.1',
  '@electron-forge/maker-rpm': '7.11.1',
  '@pengx17/electron-forge-maker-appimage': '1.2.1',
};

const PLATFORM_PACKAGES = {
  win32: ['@electron-forge/maker-squirrel', '@electron-forge/maker-wix'],
  darwin: ['@electron-forge/maker-dmg', '@electron-forge/maker-zip'],
  linux: [
    '@electron-forge/maker-deb',
    '@electron-forge/maker-rpm',
    '@pengx17/electron-forge-maker-appimage',
  ],
};

function getCliOptionValue(optionName) {
  const exactPrefix = `${optionName}=`;
  for (let index = 0; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument === optionName) {
      return process.argv[index + 1] ?? null;
    }

    if (argument.startsWith(exactPrefix)) {
      return argument.slice(exactPrefix.length);
    }
  }

  return null;
}

function resolvePackageJsonPath(packageName) {
  return path.join(process.cwd(), 'node_modules', ...packageName.split('/'), 'package.json');
}

function getInstalledVersion(packageName) {
  const packageJsonPath = resolvePackageJsonPath(packageName);
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  return JSON.parse(readFileSync(packageJsonPath, 'utf8')).version ?? null;
}

async function runNpmInstall(packagesToInstall) {
  const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const installArgs = [
    'install',
    '--no-save',
    '--no-package-lock',
    ...packagesToInstall.map((packageName) => `${packageName}@${PACKAGE_VERSIONS[packageName]}`),
  ];

  await new Promise((resolve, reject) => {
    const child = spawn(executable, installArgs, {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: false,
    });

    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`npm install exited with code ${code ?? 1}`));
    });
  });
}

function hasWindowsExecutable(commandName) {
  if (process.platform !== 'win32') {
    return false;
  }

  const result = spawnSync('where', [commandName], {
    stdio: 'ignore',
    shell: false,
  });
  return result.status === 0;
}

async function main() {
  const platform = getCliOptionValue('--platform') ?? process.platform;
  const arch = getCliOptionValue('--arch') ?? process.arch;
  const expectedPackages = PLATFORM_PACKAGES[platform];

  if (!expectedPackages) {
    const supportedPlatforms = Object.keys(PLATFORM_PACKAGES).join(', ');
    throw new Error(`Unsupported platform "${platform}". Supported values: ${supportedPlatforms}.`);
  }

  const packagesToInstall = expectedPackages.filter((packageName) => {
    return getInstalledVersion(packageName) !== PACKAGE_VERSIONS[packageName];
  });

  if (packagesToInstall.length === 0) {
    console.log(`[release-tools] Release toolchain already available for ${platform}/${arch}.`);
  } else {
    console.log(
      `[release-tools] Installing release toolchain for ${platform}/${arch}: ${packagesToInstall.join(', ')}`,
    );
    await runNpmInstall(packagesToInstall);
  }

  if (platform === 'win32' && arch === 'x64') {
    const hasWix = hasWindowsExecutable('candle.exe') && hasWindowsExecutable('light.exe');
    if (!hasWix) {
      console.warn(
        '[release-tools] WiX Toolset not detected. Local x64 make will continue with Squirrel output only until WiX is installed.',
      );
    }
  }
}

await main();
