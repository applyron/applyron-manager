import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';

function createFile(filePath: string, contents = 'fixture') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

describe('prepare-static-update-assets script', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('collects Windows and macOS static update artifacts into platform roots', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'applyron-static-assets-'));
    const sourceRoot = path.join(root, 'release-assets');
    const outputRoot = path.join(root, 'release-assets-static');
    tempRoots.push(root);

    createFile(path.join(sourceRoot, 'out', 'make', 'squirrel.windows', 'x64', 'RELEASES'));
    createFile(path.join(sourceRoot, 'out', 'make', 'squirrel.windows', 'x64', 'Applyron.exe'));
    createFile(path.join(sourceRoot, 'out', 'make', 'squirrel.windows', 'x64', 'Applyron.nupkg'));
    createFile(path.join(sourceRoot, 'out', 'make', 'zip', 'darwin', 'x64', 'RELEASES.json'));
    createFile(
      path.join(
        sourceRoot,
        'out',
        'make',
        'zip',
        'darwin',
        'x64',
        'Applyron.Manager_0.10.0_x64.zip',
      ),
    );
    createFile(
      path.join(
        sourceRoot,
        'out',
        'make',
        'dmg',
        'darwin',
        'x64',
        'Applyron.Manager_0.10.0_x64.dmg',
      ),
    );

    execFileSync(
      process.execPath,
      [
        path.resolve(process.cwd(), 'scripts/prepare-static-update-assets.mjs'),
        sourceRoot,
        outputRoot,
      ],
      { cwd: process.cwd(), stdio: 'pipe' },
    );

    expect(fs.existsSync(path.join(outputRoot, 'win32', 'x64', 'RELEASES'))).toBe(true);
    expect(fs.existsSync(path.join(outputRoot, 'win32', 'x64', 'Applyron.exe'))).toBe(true);
    expect(fs.existsSync(path.join(outputRoot, 'darwin', 'x64', 'RELEASES.json'))).toBe(true);
    expect(
      fs.existsSync(path.join(outputRoot, 'darwin', 'x64', 'Applyron.Manager_0.10.0_x64.zip')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(outputRoot, 'darwin', 'x64', 'Applyron.Manager_0.10.0_x64.dmg')),
    ).toBe(true);
  });
});
