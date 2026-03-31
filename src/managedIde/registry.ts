import type { ManagedIdeTargetDefinition, ManagedIdeTargetId } from './types';

export const DEFAULT_MANAGED_IDE_TARGET_ID: ManagedIdeTargetId = 'antigravity';

const managerProcessHints = [
  'applyron manager',
  'applyron-manager',
  'antigravity manager',
  'antigravity-manager',
];

const targetRegistry: Record<ManagedIdeTargetId, ManagedIdeTargetDefinition> = {
  antigravity: {
    id: 'antigravity',
    displayName: 'Antigravity',
    shortName: 'Antigravity',
    processDisplayName: 'Antigravity',
    appDataDirName: 'Antigravity',
    hiddenFallbackDirName: '.antigravity',
    processSearchNames: ['Antigravity', 'antigravity'],
    managerProcessHints,
    uriScheme: 'antigravity',
    macAppName: 'Antigravity',
    macExecutableName: 'Antigravity',
    windowsInstallDirNames: ['Antigravity'],
    windowsExecutableName: 'Antigravity.exe',
    linuxBinaryNames: ['antigravity'],
    capabilities: {
      accountStorageRead: true,
      quotaManagement: true,
      processControl: true,
      visibleInUi: true,
      experimental: false,
    },
  },
  'vscode-codex': {
    id: 'vscode-codex',
    displayName: 'VS Code Codex',
    shortName: 'VS Code Codex',
    processDisplayName: 'VS Code',
    appDataDirName: 'Code',
    hiddenFallbackDirName: '.code',
    processSearchNames: ['Code', 'code'],
    managerProcessHints,
    macAppName: 'Visual Studio Code',
    macExecutableName: 'Visual Studio Code',
    windowsInstallDirNames: ['Microsoft VS Code', 'VS Code', 'Code'],
    windowsExecutableName: 'Code.exe',
    linuxBinaryNames: ['code'],
    capabilities: {
      accountStorageRead: true,
      quotaManagement: true,
      processControl: true,
      visibleInUi: true,
      experimental: false,
    },
  },
};

export function getManagedIdeTarget(targetId: ManagedIdeTargetId): ManagedIdeTargetDefinition {
  return targetRegistry[targetId];
}

export function getManagedIdeTargets(): ManagedIdeTargetDefinition[] {
  return Object.values(targetRegistry);
}

export function getVisibleManagedIdeTargets(): ManagedIdeTargetDefinition[] {
  return getManagedIdeTargets().filter((target) => target.capabilities.visibleInUi);
}
