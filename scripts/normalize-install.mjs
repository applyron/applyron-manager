import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';

const nodeModulesPath = path.join(process.cwd(), 'node_modules');

function resolvePackagePath(packageName) {
  return path.join(nodeModulesPath, ...packageName.split('/'));
}

async function removeIfPresent(packageName, removedPackages) {
  const packagePath = resolvePackagePath(packageName);
  if (!existsSync(packagePath)) {
    return;
  }

  await rm(packagePath, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
  removedPackages.push(packageName);
}

async function main() {
  const removedPackages = [];

  // npm occasionally leaves broken optional maker artifacts on Windows.
  if (process.platform === 'win32') {
    for (const packageName of [
      'electron-installer-common',
      'electron-installer-debian',
      'electron-installer-redhat',
    ]) {
      await removeIfPresent(packageName, removedPackages);
    }
  }

  const wasmOwners = ['@tailwindcss/oxide-wasm32-wasi', '@img/sharp-wasm32'];
  const hasInstalledWasmOwner = wasmOwners.some((packageName) =>
    existsSync(resolvePackagePath(packageName)),
  );

  // Clean up wasm fallback runtimes when their owner packages are not installed.
  if (!hasInstalledWasmOwner) {
    for (const packageName of [
      '@emnapi/core',
      '@emnapi/runtime',
      '@emnapi/wasi-threads',
      '@napi-rs/wasm-runtime',
      '@tybys/wasm-util',
    ]) {
      await removeIfPresent(packageName, removedPackages);
    }
  }

  if (removedPackages.length > 0) {
    console.log(
      `[postinstall] Removed platform-incompatible optional artifacts: ${removedPackages.join(', ')}`,
    );
  }
}

await main();
