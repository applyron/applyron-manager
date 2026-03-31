import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import type {
  HookFunction,
  HookFunctionErrorCallback,
  TargetArch,
  TargetPlatform,
} from '@electron/packager';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { rebuild } from '@electron/rebuild';
import * as fs from 'fs';
import * as path from 'path';
import { stringify as yamlStringify } from 'yaml';
import { createDarwinStaticReleaseJson } from './src/utils/staticUpdateRelease';

const nativeRuntimeModules = ['better-sqlite3', 'keytar'];
const supportRuntimeModules = ['bindings', 'file-uri-to-path'];
const keepLanguages = new Set(['en', 'en-US', 'tr']);
const windowsExecutableName = 'applyron-manager';
const githubRepository = {
  owner: process.env.APPLYRON_GITHUB_OWNER || 'applyron',
  name: process.env.APPLYRON_GITHUB_REPO || 'applyron-manager',
};
const packageRequire = createRequire(__filename);
const npmLifecycleEvent = process.env.npm_lifecycle_event ?? '';

const isStartCommand = process.argv.some((arg) => arg.includes('start'));
const isMakeCommand =
  npmLifecycleEvent === 'make' ||
  npmLifecycleEvent === 'publish' ||
  process.argv.some((arg) => arg === 'make' || arg === 'publish');
const isE2EPackageBuild = process.env.APPLYRON_E2E === '1';
const packagerOutputDirectory = isE2EPackageBuild ? path.join('out', 'e2e') : 'out';
const productionFusesConfig = {
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
};

const artifactRegex = /.*\.(?:exe|dmg|AppImage|zip|deb|rpm|msi)$/;
const platformNamesMap: Record<string, string> = {
  darwin: 'macos',
  linux: 'linux',
  win32: 'windows',
};
const ymlBaseNameMap: Record<string, string> = {
  darwin: 'latest-mac',
  linux: 'latest-linux',
  win32: 'latest',
};
type ForgeMaker = NonNullable<ForgeConfig['makers']>[number];
type MakerConstructor = new (config?: unknown, platforms?: string[]) => ForgeMaker;

function getCliOptionValue(optionName: string) {
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

function getRequestedPlatform() {
  return getCliOptionValue('--platform') ?? (isMakeCommand ? process.platform : null);
}

function getRequestedArch() {
  return getCliOptionValue('--arch') ?? (isMakeCommand ? process.arch : null);
}

function getReleaseToolsInstallCommand(platform: string, arch: string) {
  return `npm run install:release-tools -- --platform=${platform} --arch=${arch}`;
}

function hasWindowsExecutable(commandName: string) {
  if (process.platform !== 'win32') {
    return false;
  }

  const result = spawnSync('where', [commandName], {
    stdio: 'ignore',
    shell: false,
  });
  return result.status === 0;
}

function isMissingModuleError(error: unknown, packageName: string) {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 'MODULE_NOT_FOUND' &&
    error.message.includes(packageName)
  );
}

function loadRequiredPackage<T>(packageName: string, installCommand: string): T {
  try {
    return packageRequire(packageName) as T;
  } catch (error) {
    if (isMissingModuleError(error, packageName)) {
      throw new Error(
        `Missing release maker package "${packageName}". Run \`${installCommand}\` and retry.`,
      );
    }

    throw error;
  }
}

function getModuleExport<T>(loadedModule: { default?: T } | T) {
  if (typeof loadedModule === 'object' && loadedModule !== null && 'default' in loadedModule) {
    return (loadedModule.default ?? loadedModule) as T;
  }

  return loadedModule as T;
}

function ensureDirectoryExists(directoryPath: string) {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
}

function verifyNativeRuntimeModules(buildPath: string) {
  const nodeModulesPath = path.join(buildPath, 'node_modules');
  for (const moduleName of nativeRuntimeModules) {
    const modulePath = path.join(nodeModulesPath, moduleName);
    if (!fs.existsSync(modulePath)) {
      throw new Error(
        `Missing native runtime module "${moduleName}" in packaged app. Refusing to copy the host-built module into the Electron bundle.`,
      );
    }

    console.log(`Verified packaged native runtime module: ${moduleName}`);
  }
}

function copyRuntimeModules(buildPath: string, moduleNames: string[]) {
  const nodeModulesPath = path.join(buildPath, 'node_modules');
  ensureDirectoryExists(nodeModulesPath);

  for (const moduleName of moduleNames) {
    const srcPath = path.join(process.cwd(), 'node_modules', moduleName);
    const destPath = path.join(nodeModulesPath, moduleName);

    if (!fs.existsSync(srcPath)) {
      console.warn(`Runtime module not found: ${moduleName}`);
      continue;
    }

    fs.rmSync(destPath, { recursive: true, force: true });
    fs.cpSync(srcPath, destPath, { recursive: true, force: true });
    console.log(`Copied runtime module before rebuild: ${moduleName}`);
  }
}

function copyRuntimePackageManifest(buildPath: string) {
  const srcPath = path.join(process.cwd(), 'package.json');
  const destPath = path.join(buildPath, 'package.json');

  if (!fs.existsSync(srcPath)) {
    throw new Error(`Runtime package manifest not found: ${srcPath}`);
  }

  fs.copyFileSync(srcPath, destPath);
  console.log(`Copied runtime package manifest to ${destPath}`);
}

function copyMissingSupportRuntimeModules(buildPath: string) {
  const nodeModulesPath = path.join(buildPath, 'node_modules');
  ensureDirectoryExists(nodeModulesPath);

  for (const moduleName of supportRuntimeModules) {
    const srcPath = path.join(process.cwd(), 'node_modules', moduleName);
    const destPath = path.join(nodeModulesPath, moduleName);

    if (fs.existsSync(destPath)) {
      console.log(`Support runtime module already present after prune: ${moduleName}`);
      continue;
    }

    if (!fs.existsSync(srcPath)) {
      console.warn(`Runtime module not found: ${moduleName}`);
      continue;
    }

    fs.rmSync(destPath, { recursive: true, force: true });
    fs.cpSync(srcPath, destPath, { recursive: true, force: true });
    console.log(`Copied support runtime module after prune: ${moduleName}`);
  }
}

function copyAssets(buildPath: string) {
  const assetsSrc = path.join(process.cwd(), 'src', 'assets');
  const assetsDest = path.join(buildPath, 'resources', 'assets');

  if (!fs.existsSync(assetsSrc)) {
    console.warn(`Assets directory not found: ${assetsSrc}`);
    return;
  }

  ensureDirectoryExists(assetsDest);
  fs.cpSync(assetsSrc, assetsDest, { recursive: true, force: true });
  console.log(`Copied assets from ${assetsSrc} to ${assetsDest}`);
}

function pruneElectronLocales(buildPath: string) {
  const localesDirectory = path.join(buildPath, 'locales');
  if (!fs.existsSync(localesDirectory)) {
    return;
  }

  for (const entry of fs.readdirSync(localesDirectory, { withFileTypes: true })) {
    const localeName = path.parse(entry.name).name;
    if (keepLanguages.has(localeName)) {
      continue;
    }

    fs.rmSync(path.join(localesDirectory, entry.name), {
      recursive: true,
      force: true,
    });
  }
}

const packagerAfterCopy: HookFunction[] = [
  (
    buildPath: string,
    _electronVersion: string,
    platform: TargetPlatform,
    _arch: TargetArch,
    callback: HookFunctionErrorCallback,
  ) => {
    if (platform !== 'win32') {
      callback();
      return;
    }

    try {
      pruneElectronLocales(buildPath);
      callback();
    } catch (error) {
      callback(error as Error);
    }
  },
];

function normalizeArtifactName(value?: string) {
  if (!value) {
    return 'app';
  }

  return value
    .trim()
    .replace(/\s+/g, '.')
    .replace(/[^a-zA-Z0-9.]/g, '')
    .replace(/\.+/g, '.');
}

function isSquirrelArtifact(artifactPath: string) {
  const fileName = path.basename(artifactPath);
  if (fileName === 'RELEASES') {
    return true;
  }

  return artifactPath.endsWith('.nupkg');
}

function mapArchName(arch: string, mapping: Record<string, string>) {
  return mapping[arch] || arch;
}

function getArtifactFileName({
  baseName,
  version,
  arch,
  extension,
}: {
  baseName: string;
  version: string;
  arch: string;
  extension: string;
}) {
  if (extension === '.rpm') {
    return `${baseName}-${version}-1.${arch}${extension}`;
  }

  if (extension === '.deb') {
    return `${baseName}_${version}_${arch}${extension}`;
  }

  if (extension === '.AppImage') {
    return `${baseName}_${version}_${arch}${extension}`;
  }

  if (extension === '.dmg') {
    return `${baseName}_${version}_${arch}${extension}`;
  }

  if (extension === '.exe') {
    return `${baseName}_${version}_${arch}-setup${extension}`;
  }

  if (extension === '.msi') {
    return `${baseName}_${version}_${arch}_en-US${extension}`;
  }

  if (extension === '.zip') {
    return `${baseName}_${version}_${arch}${extension}`;
  }

  return `${baseName}_${version}_${arch}${extension}`;
}

function getUpdateYmlFileName(platform: string, arch: string) {
  const baseName = ymlBaseNameMap[platform];
  if (!baseName) {
    return null;
  }

  if (platform === 'darwin') {
    return arch === 'universal' ? `${baseName}.yml` : `${baseName}-${arch}.yml`;
  }

  if (platform === 'linux') {
    return arch === 'x64' ? `${baseName}.yml` : `${baseName}-${arch}.yml`;
  }

  if (platform === 'win32') {
    return arch === 'x64' ? `${baseName}.yml` : `${baseName}-${arch}.yml`;
  }

  return null;
}

function getChecksumArchLabel(platform: string, arch: string) {
  if (platform === 'linux') {
    return mapArchName(arch, { x64: 'amd64', arm64: 'aarch64' });
  }

  if (platform === 'darwin') {
    return mapArchName(arch, { x64: 'x64', arm64: 'arm64', universal: 'universal' });
  }

  if (platform === 'win32') {
    return mapArchName(arch, { x64: 'x64', arm64: 'arm64' });
  }

  return arch;
}

function createWindowsMakers(targetArch: string): ForgeMaker[] {
  const installCommand = getReleaseToolsInstallCommand('win32', targetArch);
  const loadedSquirrelModule = loadRequiredPackage<{
    MakerSquirrel: MakerConstructor;
  }>('@electron-forge/maker-squirrel', installCommand);
  const makers: ForgeMaker[] = [
    new loadedSquirrelModule.MakerSquirrel({
      setupIcon: 'images/icon.ico',
      iconUrl: `https://raw.githubusercontent.com/${githubRepository.owner}/${githubRepository.name}/main/images/icon.ico`,
    }),
  ];

  if (targetArch === 'x64') {
    if (hasWindowsExecutable('candle.exe') && hasWindowsExecutable('light.exe')) {
      const loadedWixModule = loadRequiredPackage<{
        MakerWix: MakerConstructor;
      }>('@electron-forge/maker-wix', installCommand);
      makers.push(
        new loadedWixModule.MakerWix({
          language: 1033,
          icon: path.join(process.cwd(), 'images', 'icon.ico'),
          exe: `${windowsExecutableName}.exe`,
          ui: { chooseDirectory: true },
        }),
      );
    } else {
      console.warn(
        '[forge] WiX Toolset not detected; skipping MSI maker for local win32/x64 packaging.',
      );
    }
  }

  return makers;
}

function createDarwinMakers(targetArch: string): ForgeMaker[] {
  const installCommand = getReleaseToolsInstallCommand('darwin', targetArch);
  const loadedDmgModule = loadRequiredPackage<{
    MakerDMG: MakerConstructor;
  }>('@electron-forge/maker-dmg', installCommand);
  const loadedZipModule = loadRequiredPackage<{
    MakerZIP: MakerConstructor;
  }>('@electron-forge/maker-zip', installCommand);

  return [
    new loadedDmgModule.MakerDMG(
      {
        overwrite: true,
        icon: 'images/icon.icns',
        iconSize: 160,
      },
      ['darwin'],
    ),
    new loadedZipModule.MakerZIP({}, ['darwin']),
  ];
}

function createLinuxMakers(targetArch: string): ForgeMaker[] {
  const installCommand = getReleaseToolsInstallCommand('linux', targetArch);
  const loadedDebModule = loadRequiredPackage<{
    MakerDeb: MakerConstructor;
  }>('@electron-forge/maker-deb', installCommand);
  const loadedRpmModule = loadRequiredPackage<{
    MakerRpm: MakerConstructor;
  }>('@electron-forge/maker-rpm', installCommand);
  const loadedAppImageModule = loadRequiredPackage<{ default?: MakerConstructor }>(
    '@pengx17/electron-forge-maker-appimage',
    installCommand,
  );
  const AppImageMaker = getModuleExport<MakerConstructor>(loadedAppImageModule);
  const appImageMaker = new AppImageMaker({
    config: {
      icons: [
        {
          file: 'images/32x32.png',
          size: 32,
        },
        {
          file: 'images/64x64.png',
          size: 64,
        },
        {
          file: 'images/128x128.png',
          size: 128,
        },
        {
          file: 'images/128x128@2x.png',
          size: 256,
        },
      ],
    },
  });
  const namedAppImageMaker = appImageMaker as ForgeMaker & { name?: string };
  namedAppImageMaker.name = '@pengx17/electron-forge-maker-appimage';

  return [namedAppImageMaker, new loadedRpmModule.MakerRpm({}), new loadedDebModule.MakerDeb({})];
}

function resolveMakers(): ForgeMaker[] {
  if (!isMakeCommand) {
    return [];
  }

  const targetPlatform = getRequestedPlatform();
  const targetArch = getRequestedArch();

  if (!targetPlatform || !targetArch) {
    return [];
  }

  if (targetPlatform === 'win32') {
    return createWindowsMakers(targetArch);
  }

  if (targetPlatform === 'darwin') {
    return createDarwinMakers(targetArch);
  }

  if (targetPlatform === 'linux') {
    return createLinuxMakers(targetArch);
  }

  throw new Error(`Unsupported packaging platform "${targetPlatform}".`);
}

const config: ForgeConfig = {
  outDir: packagerOutputDirectory,
  packagerConfig: {
    asar: isE2EPackageBuild
      ? false
      : {
          unpack: '**/{better-sqlite3,keytar}/**/*',
        },
    name: 'Applyron Manager',
    executableName: windowsExecutableName,
    icon: 'images/icon', // Electron Forge automatically adds .icns/.ico
    extraResource: ['src/assets'], // Copy assets folder to resources/assets
    afterCopy: packagerAfterCopy,
    prune: true,
  },
  rebuildConfig: {
    force: true,
  },
  hooks: {
    packageAfterCopy: async (_config, buildPath, electronVersion, _platform, arch) => {
      copyAssets(buildPath);
      copyRuntimePackageManifest(buildPath);
      copyRuntimeModules(buildPath, [...nativeRuntimeModules, ...supportRuntimeModules]);
      await rebuild({
        buildPath,
        electronVersion,
        arch,
        force: true,
        onlyModules: nativeRuntimeModules,
        projectRootPath: process.cwd(),
      });
    },
    packageAfterPrune: async (_config, buildPath) => {
      verifyNativeRuntimeModules(buildPath);
      copyMissingSupportRuntimeModules(buildPath);
    },
    postMake: async (_config, makeResults) => {
      if (!makeResults?.length) {
        return makeResults;
      }

      const ymlByTarget = new Map<
        string,
        {
          basePath: string;
          fileName: string;
          yml: {
            version?: string;
            files: {
              url: string;
              sha512: string;
              size: number;
            }[];
            releaseDate?: string;
          };
        }
      >();
      const checksumByTarget = new Map<
        string,
        {
          basePath: string;
          fileName: string;
          lines: string[];
        }
      >();
      const darwinReleaseJsonByTarget = new Map<
        string,
        {
          basePath: string;
          fileName: string;
          zipFileName: string | null;
          version: string;
        }
      >();

      makeResults = makeResults.map((result) => {
        const productName = normalizeArtifactName(
          result.packageJSON.productName || result.packageJSON.name,
        );
        const platformName = platformNamesMap[result.platform] || result.platform;
        const version = result.packageJSON.version;
        const platformKey = result.platform;
        const archKey = result.arch;
        const updateFileName = getUpdateYmlFileName(platformKey, archKey);
        const updateKey = updateFileName ? `${platformKey}-${archKey}` : null;
        const checksumKey = `${platformKey}-${archKey}`;
        const checksumArchLabel = getChecksumArchLabel(platformKey, archKey);
        const checksumFileName = `sha256sums-${platformName}-${checksumArchLabel}.txt`;

        if (!checksumByTarget.has(checksumKey)) {
          checksumByTarget.set(checksumKey, {
            basePath: '',
            fileName: checksumFileName,
            lines: [],
          });
        }
        if (platformKey === 'darwin' && !darwinReleaseJsonByTarget.has(checksumKey)) {
          darwinReleaseJsonByTarget.set(checksumKey, {
            basePath: '',
            fileName: 'RELEASES.json',
            zipFileName: null,
            version,
          });
        }

        if (updateFileName && updateKey && !ymlByTarget.has(updateKey)) {
          ymlByTarget.set(updateKey, {
            basePath: '',
            fileName: updateFileName,
            yml: {
              version,
              files: [],
            },
          });
        }

        const updateState = updateKey ? ymlByTarget.get(updateKey)! : null;
        const checksumState = checksumByTarget.get(checksumKey)!;
        const darwinReleaseState =
          platformKey === 'darwin' ? darwinReleaseJsonByTarget.get(checksumKey)! : null;

        result.artifacts = result.artifacts
          .map((artifact) => {
            if (!artifact) {
              return null;
            }

            if (isSquirrelArtifact(artifact)) {
              return artifact;
            }

            if (!artifactRegex.test(artifact)) {
              return artifact;
            }

            if (!checksumState.basePath) {
              checksumState.basePath = path.dirname(artifact);
            }

            if (updateState && !updateState.basePath) {
              updateState.basePath = path.dirname(artifact);
            }

            const extension = path.extname(artifact);
            let archLabel = archKey;
            if (platformKey === 'linux' && extension === '.rpm') {
              archLabel = mapArchName(archKey, { x64: 'x86_64', arm64: 'aarch64' });
            } else if (platformKey === 'linux' && extension === '.deb') {
              archLabel = mapArchName(archKey, { x64: 'amd64', arm64: 'arm64' });
            } else if (platformKey === 'linux' && extension === '.AppImage') {
              archLabel = mapArchName(archKey, { x64: 'amd64', arm64: 'aarch64' });
            } else if (platformKey === 'darwin') {
              archLabel = mapArchName(archKey, {
                x64: 'x64',
                arm64: 'arm64',
                universal: 'universal',
              });
            } else if (platformKey === 'win32') {
              archLabel = mapArchName(archKey, { x64: 'x64', arm64: 'arm64' });
            }

            const newArtifact = `${path.dirname(artifact)}/${getArtifactFileName({
              baseName: productName,
              version,
              arch: archLabel,
              extension,
            })}`;
            if (newArtifact !== artifact) {
              fs.renameSync(artifact, newArtifact);
            }

            try {
              const fileData = fs.readFileSync(newArtifact);
              const hash = crypto.createHash('sha512').update(fileData).digest('base64');
              const sha256 = crypto.createHash('sha256').update(fileData).digest('hex');
              const { size } = fs.statSync(newArtifact);

              if (updateState) {
                updateState.yml.files.push({
                  url: path.basename(newArtifact),
                  sha512: hash,
                  size,
                });
              }

              checksumState.lines.push(`${sha256}  ${path.basename(newArtifact)}`);

              if (darwinReleaseState && extension === '.zip') {
                darwinReleaseState.basePath = path.dirname(newArtifact);
                darwinReleaseState.zipFileName = path.basename(newArtifact);
              }
            } catch {
              console.error(`Failed to hash ${newArtifact}`);
            }

            return newArtifact;
          })
          .filter((artifact) => artifact !== null);

        return result;
      });

      const releaseDate = new Date().toISOString();
      for (const [updateKey, updateState] of ymlByTarget.entries()) {
        if (!updateState.basePath) {
          continue;
        }

        updateState.yml.releaseDate = releaseDate;
        const ymlPath = path.join(updateState.basePath, updateState.fileName);
        fs.writeFileSync(ymlPath, yamlStringify(updateState.yml));

        const [platform, arch] = updateKey.split('-');
        const sampleResult = makeResults.find(
          (result) => result.platform === platform && result.arch === arch,
        );
        if (!sampleResult) {
          continue;
        }

        makeResults.push({
          artifacts: [ymlPath],
          platform: sampleResult.platform,
          arch: sampleResult.arch,
          packageJSON: sampleResult.packageJSON,
        });
      }

      for (const [releaseKey, releaseState] of darwinReleaseJsonByTarget.entries()) {
        if (!releaseState.basePath || !releaseState.zipFileName) {
          continue;
        }

        const releaseJsonPath = path.join(releaseState.basePath, releaseState.fileName);
        fs.writeFileSync(
          releaseJsonPath,
          `${JSON.stringify(
            createDarwinStaticReleaseJson({
              version: releaseState.version,
              zipFileName: releaseState.zipFileName,
              publishedAt: releaseDate,
            }),
            null,
            2,
          )}\n`,
        );

        const [platform, arch] = releaseKey.split('-');
        const sampleResult = makeResults.find(
          (result) => result.platform === platform && result.arch === arch,
        );
        if (!sampleResult) {
          continue;
        }

        makeResults.push({
          artifacts: [releaseJsonPath],
          platform: sampleResult.platform,
          arch: sampleResult.arch,
          packageJSON: sampleResult.packageJSON,
        });
      }

      for (const [checksumKey, checksumState] of checksumByTarget.entries()) {
        if (!checksumState.basePath || checksumState.lines.length === 0) {
          continue;
        }

        const checksumPath = path.join(checksumState.basePath, checksumState.fileName);
        fs.writeFileSync(checksumPath, `${checksumState.lines.join('\n')}\n`);

        const [platform, arch] = checksumKey.split('-');
        const sampleResult = makeResults.find(
          (result) => result.platform === platform && result.arch === arch,
        );
        if (!sampleResult) {
          continue;
        }

        makeResults.push({
          artifacts: [checksumPath],
          platform: sampleResult.platform,
          arch: sampleResult.arch,
          packageJSON: sampleResult.packageJSON,
        });
      }

      return makeResults;
    },
  },
  makers: resolveMakers(),
  publishers: [
    {
      /*
       * Publish release on GitHub as draft.
       * Remember to manually publish it on GitHub website after verifying everything is correct.
       */
      name: '@electron-forge/publisher-github',
      config: {
        repository: githubRepository,
        draft: true,
        prerelease: false,
      },
    },
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    ...(!isStartCommand
      ? [
          ...(!isE2EPackageBuild
            ? [
                new AutoUnpackNativesPlugin({}),
                new FusesPlugin({
                  version: FuseVersion.V1,
                  ...productionFusesConfig,
                }),
              ]
            : []),
        ]
      : []),
  ],
};

export default config;
