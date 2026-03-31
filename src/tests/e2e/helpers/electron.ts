import { type ElectronApplication, _electron as electron } from '@playwright/test';
import { parseElectronApp } from 'electron-playwright-helpers';
import fs from 'node:fs';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';

const e2eBuildDirectory = 'out/e2e';
const fallbackBuildDirectory = 'out';
const MAX_DIAGNOSTIC_CHARS = 8_000;
type LaunchExitState = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

type LaunchDiagnostics = {
  exitState: LaunchExitState | null;
  exitPromise: Promise<LaunchExitState>;
  recentStdout: string[];
  recentStderr: string[];
};

const launchDiagnostics = new WeakMap<ElectronApplication, LaunchDiagnostics>();

function* iterateAncestorDirectories(startDirectory: string): Generator<string> {
  let currentDirectory = path.resolve(startDirectory);

  while (true) {
    yield currentDirectory;

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return;
    }

    currentDirectory = parentDirectory;
  }
}

function getCandidateSearchDirectories(): string[] {
  const explicitRepositoryRoot = process.env.APPLYRON_REPO_ROOT?.trim();
  const npmInitCwd = process.env.INIT_CWD?.trim();
  const npmPackageJsonPath = process.env.npm_package_json?.trim();
  return [
    explicitRepositoryRoot,
    __dirname,
    npmInitCwd,
    npmPackageJsonPath ? path.dirname(npmPackageJsonPath) : null,
    process.cwd(),
  ].filter((value): value is string => Boolean(value));
}

function getCandidateBuildRootDirectories(): string[] {
  const discoveredBuildRoots = new Set<string>();

  for (const candidateDirectory of getCandidateSearchDirectories()) {
    for (const ancestorDirectory of iterateAncestorDirectories(candidateDirectory)) {
      for (const buildDirectory of [e2eBuildDirectory, fallbackBuildDirectory]) {
        const absoluteBuildDirectory = path.join(ancestorDirectory, buildDirectory);
        if (
          fs.existsSync(absoluteBuildDirectory) &&
          fs.statSync(absoluteBuildDirectory).isDirectory()
        ) {
          discoveredBuildRoots.add(absoluteBuildDirectory);
        }
      }
    }
  }

  return [...discoveredBuildRoots];
}

function resolveLatestBuildDirectory(): string {
  const candidates = getCandidateBuildRootDirectories()
    .flatMap((buildRootDirectory) =>
      fs
        .readdirSync(buildRootDirectory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(buildRootDirectory, entry.name)),
    )
    .filter((entryPath) => {
      try {
        const appInfo = parseElectronApp(entryPath);
        return fs.existsSync(appInfo.executable) && fs.existsSync(appInfo.main);
      } catch {
        return false;
      }
    })
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);

  if (candidates.length === 0) {
    const scannedRoots = getCandidateBuildRootDirectories();
    const details =
      scannedRoots.length > 0
        ? `Scanned build roots: ${scannedRoots.join(', ')}`
        : `No candidate build roots were discovered from: ${getCandidateSearchDirectories().join(', ')}`;
    throw new Error(`No build found in packaged output directories.\n${details}`);
  }

  return candidates[0];
}

function pushDiagnosticChunk(chunks: string[], value: string) {
  if (!value) {
    return;
  }

  chunks.push(value);
  let totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  while (totalLength > MAX_DIAGNOSTIC_CHARS && chunks.length > 1) {
    const removed = chunks.shift();
    totalLength -= removed?.length ?? 0;
  }
}

function registerLaunchDiagnostics(app: ElectronApplication, child: ChildProcess | null) {
  const recentStdout: string[] = [];
  const recentStderr: string[] = [];
  const diagnostics: LaunchDiagnostics = {
    exitState: null,
    exitPromise: Promise.resolve({ code: null, signal: null }),
    recentStdout,
    recentStderr,
  };

  if (child?.stdout) {
    child.stdout.on('data', (chunk) => {
      pushDiagnosticChunk(recentStdout, chunk.toString());
    });
  }

  if (child?.stderr) {
    child.stderr.on('data', (chunk) => {
      pushDiagnosticChunk(recentStderr, chunk.toString());
    });
  }

  diagnostics.exitPromise = new Promise<LaunchExitState>((resolve) => {
    if (!child) {
      resolve({ code: null, signal: null });
      return;
    }

    child.once('exit', (code, signal) => {
      diagnostics.exitState = { code, signal };
      resolve(diagnostics.exitState);
    });
  });

  launchDiagnostics.set(app, diagnostics);
}

function formatLaunchDiagnostics(app: ElectronApplication): string {
  const diagnostics = launchDiagnostics.get(app);
  if (!diagnostics) {
    return 'No launch diagnostics were captured.';
  }

  const sections: string[] = [];
  if (diagnostics.exitState) {
    sections.push(
      `Electron process exited before opening a window (code=${diagnostics.exitState.code}, signal=${diagnostics.exitState.signal ?? 'none'}).`,
    );
  }

  const stdout = diagnostics.recentStdout.join('').trim();
  const stderr = diagnostics.recentStderr.join('').trim();

  if (stdout) {
    sections.push(`Recent stdout:\n${stdout}`);
  }

  if (stderr) {
    sections.push(`Recent stderr:\n${stderr}`);
  }

  return sections.length > 0 ? sections.join('\n\n') : 'No child-process output was captured.';
}

export async function launchPackagedElectronApp(): Promise<ElectronApplication> {
  return await launchPackagedElectronAppWithOptions();
}

export async function waitForPackagedFirstWindow(app: ElectronApplication, timeout = 120_000) {
  const diagnostics = launchDiagnostics.get(app);
  const firstWindowPromise = app.firstWindow({ timeout });

  if (!diagnostics) {
    return await firstWindowPromise;
  }

  try {
    return await Promise.race([
      firstWindowPromise,
      diagnostics.exitPromise.then(() => {
        throw new Error(formatLaunchDiagnostics(app));
      }),
    ]);
  } catch (error) {
    const diagnosticText = formatLaunchDiagnostics(app);
    const baseMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`${baseMessage}\n\n${diagnosticText}`);
  }
}

export async function launchPackagedElectronAppWithOptions({
  env = {},
  args = [],
}: {
  env?: NodeJS.ProcessEnv;
  args?: string[];
} = {}): Promise<ElectronApplication> {
  const latestBuild = resolveLatestBuildDirectory();
  const appInfo = parseElectronApp(latestBuild);
  const launchEnv = Object.fromEntries(
    Object.entries({
      ...process.env,
      ...env,
    }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );

  const app = await electron.launch({
    args: [appInfo.main, ...args],
    executablePath: appInfo.executable,
    env: launchEnv,
  });

  registerLaunchDiagnostics(app, app.process());
  return app;
}

export async function closeElectronApp(app?: ElectronApplication): Promise<void> {
  if (!app) {
    return;
  }

  try {
    await app.close();
  } catch {
    // Ignore teardown failures so the original test error stays visible.
  }
}
