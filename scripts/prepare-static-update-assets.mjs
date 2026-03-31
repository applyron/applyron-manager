import fs from 'fs';
import path from 'path';

const sourceRoot = path.resolve(process.argv[2] || 'release-assets');
const outputRoot = path.resolve(process.argv[3] || 'release-assets-static');

const TARGET_MARKERS = [
  {
    platform: 'win32',
    marker: `${path.sep}squirrel.windows${path.sep}`,
    resolve(filePath) {
      const relativeAfterMarker = filePath.slice(
        filePath.indexOf(this.marker) + this.marker.length,
      );
      const [arch] = relativeAfterMarker.split(path.sep);
      const fileName = path.basename(filePath);
      if (
        !arch ||
        !(
          fileName === 'RELEASES' ||
          fileName.endsWith('.exe') ||
          fileName.endsWith('.nupkg') ||
          fileName.endsWith('.txt') ||
          fileName.endsWith('.yml')
        )
      ) {
        return null;
      }

      return { platform: this.platform, arch, fileName };
    },
  },
  {
    platform: 'win32',
    marker: `${path.sep}wix${path.sep}`,
    resolve(filePath) {
      const relativeAfterMarker = filePath.slice(
        filePath.indexOf(this.marker) + this.marker.length,
      );
      const [arch] = relativeAfterMarker.split(path.sep);
      const fileName = path.basename(filePath);
      if (
        !arch ||
        !(fileName.endsWith('.msi') || fileName.endsWith('.txt') || fileName.endsWith('.yml'))
      ) {
        return null;
      }

      return { platform: this.platform, arch, fileName };
    },
  },
  {
    platform: 'darwin',
    marker: `${path.sep}zip${path.sep}darwin${path.sep}`,
    resolve(filePath) {
      const relativeAfterMarker = filePath.slice(
        filePath.indexOf(this.marker) + this.marker.length,
      );
      const [arch] = relativeAfterMarker.split(path.sep);
      const fileName = path.basename(filePath);
      if (
        !arch ||
        !(
          fileName === 'RELEASES.json' ||
          fileName.endsWith('.zip') ||
          fileName.endsWith('.txt') ||
          fileName.endsWith('.yml')
        )
      ) {
        return null;
      }

      return { platform: this.platform, arch, fileName };
    },
  },
  {
    platform: 'darwin',
    marker: `${path.sep}dmg${path.sep}darwin${path.sep}`,
    resolve(filePath) {
      const relativeAfterMarker = filePath.slice(
        filePath.indexOf(this.marker) + this.marker.length,
      );
      const [arch] = relativeAfterMarker.split(path.sep);
      const fileName = path.basename(filePath);
      if (
        !arch ||
        !(fileName.endsWith('.dmg') || fileName.endsWith('.txt') || fileName.endsWith('.yml'))
      ) {
        return null;
      }

      return { platform: this.platform, arch, fileName };
    },
  },
];

function walkFiles(directoryPath) {
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function resolveTarget(filePath) {
  for (const target of TARGET_MARKERS) {
    if (!filePath.includes(target.marker)) {
      continue;
    }

    const resolved = target.resolve(filePath);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

if (!fs.existsSync(sourceRoot)) {
  console.error(`[prepare-static-update-assets] Source directory not found: ${sourceRoot}`);
  process.exit(1);
}

fs.rmSync(outputRoot, { recursive: true, force: true });
ensureDirectory(outputRoot);

const copiedFiles = [];
for (const filePath of walkFiles(sourceRoot)) {
  const target = resolveTarget(filePath);
  if (!target) {
    continue;
  }

  const destinationDirectory = path.join(outputRoot, target.platform, target.arch);
  const destinationPath = path.join(destinationDirectory, target.fileName);
  ensureDirectory(destinationDirectory);
  fs.copyFileSync(filePath, destinationPath);
  copiedFiles.push(destinationPath);
}

if (copiedFiles.length === 0) {
  console.error(
    `[prepare-static-update-assets] No static update artifacts were found under ${sourceRoot}`,
  );
  process.exit(1);
}

const groupedCounts = copiedFiles.reduce((summary, filePath) => {
  const relativePath = path.relative(outputRoot, filePath);
  const [platform, arch] = relativePath.split(path.sep);
  const key = `${platform}/${arch}`;
  summary.set(key, (summary.get(key) || 0) + 1);
  return summary;
}, new Map());

for (const [target, count] of groupedCounts.entries()) {
  console.log(`[prepare-static-update-assets] ${target}: ${count} files`);
}
