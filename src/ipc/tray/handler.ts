import { app, Tray, Menu, nativeImage, BrowserWindow } from 'electron';
import path from 'path';
import { CloudAccount } from '../../types/cloudAccount';
import { logger } from '../../utils/logger';
import { getTrayTexts } from './i18n';
import { CloudAccountRepo } from '../database/cloudHandler';
import { GoogleAPIService } from '../../services/GoogleAPIService';
import { MANAGER_PRODUCT_NAME } from '../../config/managerBrand';
import { ConfigManager } from '../config/manager';
import { ManagedIdeService } from '../../managedIde/service';
import type { ManagedIdeCurrentStatus } from '../../managedIde/types';
import { getManagedIdeTarget } from '../../managedIde/registry';
import type { AppUpdateStatus } from '../../types/dashboard';
import { buildUpdateMenuItems } from './updateMenu';
import {
  getCodexRemainingRequestPercent,
  getCodexWindowKind,
  normalizeCodexAgentMode,
  normalizeCodexServiceTier,
  prettifyCodexValue,
} from '../../managedIde/codexMetadata';

let tray: Tray | null = null;
let globalMainWindow: BrowserWindow | null = null;
let lastAccount: CloudAccount | null = null;
let lastLanguage: string = 'en';
let lastUpdateStatus: AppUpdateStatus | null = null;

function getQuotaText(account: CloudAccount | null, texts: any): string[] {
  if (!account) return [`${texts.quota}: --`];
  if (!account.quota || !account.quota.models) return [`${texts.quota}: ${texts.unknown_quota}`];

  const lines: string[] = [];
  const models = account.quota.models;

  let gHigh = 0;
  let gImage = 0;
  let claude = 0;

  for (const [key, val] of Object.entries(models)) {
    const k = key.toLowerCase();
    if (k.includes('high')) gHigh = val.percentage;
    else if (k.includes('image')) gImage = val.percentage;
    else if (k.includes('claude')) claude = val.percentage;
  }

  lines.push(`${texts.gemini_high}: ${gHigh}%`);
  lines.push(`${texts.gemini_image}: ${gImage}%`);
  lines.push(`${texts.claude45}: ${claude}%`);

  return lines;
}

function getCodexQuotaText(
  status: ManagedIdeCurrentStatus,
  texts: ReturnType<typeof getTrayTexts>,
): string[] {
  const quota = status.quota;
  if (!quota) {
    return [`${texts.quota}: ${texts.unknown_quota}`];
  }

  const formatServiceTier = (value: string | null | undefined) => {
    const normalized = normalizeCodexServiceTier(value);
    if (normalized === 'fast') return texts.fast;
    if (normalized === 'flex') return texts.flex;
    if (normalized === 'priority') return texts.priority;
    if (normalized === 'standard') return texts.standard;
    return prettifyCodexValue(normalized) || texts.unknown_quota;
  };

  const formatAgentMode = (value: string | null | undefined) => {
    const normalized = normalizeCodexAgentMode(value);
    if (normalized === 'full-access') return texts.full_access;
    if (normalized === 'read-only') return texts.read_only;
    if (normalized === 'workspace-write') return texts.workspace_write;
    if (normalized === 'danger-full-access') return texts.danger_full_access;
    return prettifyCodexValue(normalized) || texts.unknown_quota;
  };

  const formatRemaining = (
    usedPercent: number | null | undefined,
    windowDurationMins: number | null | undefined,
  ) => {
    const remaining = getCodexRemainingRequestPercent(usedPercent);
    const windowKind = getCodexWindowKind(windowDurationMins);
    const windowLabel =
      windowKind === 'fiveHours'
        ? texts.five_hour_window
        : windowKind === 'weekly'
          ? texts.weekly_window
          : texts.generic_window;

    return `${texts.remaining_requests} (${windowLabel}): ${remaining !== null ? `${remaining}%` : texts.unknown_quota}`;
  };

  return [
    `${texts.service_tier}: ${formatServiceTier(status.session.serviceTier || status.session.planType)}`,
    `${texts.agent_mode}: ${formatAgentMode(status.session.agentMode)}`,
    formatRemaining(quota.primary?.usedPercent, quota.primary?.windowDurationMins),
    formatRemaining(quota.secondary?.usedPercent, quota.secondary?.windowDurationMins),
    `${texts.credits}: ${quota.credits?.unlimited ? 'Unlimited' : quota.credits?.balance || texts.unknown_quota}`,
  ];
}

function buildAntigravityMenu(
  account: CloudAccount | null,
  texts: ReturnType<typeof getTrayTexts>,
): Electron.MenuItemConstructorOptions[] {
  const quotaLines = getQuotaText(account, texts);
  const classicTarget = getManagedIdeTarget('antigravity');

  return [
    {
      label: `${texts.target}: ${classicTarget.displayName}`,
      enabled: false,
    },
    {
      label: account
        ? `${texts.current}: ${account.email}`
        : `${texts.current}: ${texts.no_account}`,
      enabled: false,
    },
    ...quotaLines.map((line) => ({ label: line, enabled: false })),
    { type: 'separator' },
    {
      label: texts.switch_next,
      click: async () => {
        try {
          const accounts = await CloudAccountRepo.getAccounts();
          if (accounts.length === 0) return;

          const current = accounts.find((a) => a.is_active);
          let nextIndex = 0;
          if (current) {
            const idx = accounts.findIndex((a) => a.id === current.id);
            nextIndex = (idx + 1) % accounts.length;
          }
          const next = accounts[nextIndex];

          CloudAccountRepo.setActive(next.id);
          logger.info(`Tray: Switched to account ${next.email}`);

          updateTrayMenu(next, lastLanguage);

          if (globalMainWindow) {
            globalMainWindow.webContents.send('tray://account-switched', next.id);
          }
        } catch (e) {
          logger.error('Tray: Switch account failed', e);
        }
      },
    },
    {
      label: texts.refresh_current,
      click: async () => {
        try {
          const accounts = await CloudAccountRepo.getAccounts();
          const current = accounts.find((a) => a.is_active);
          if (!current) return;

          logger.info(`Tray: Refreshing quota for ${current.email}`);

          const quota = await GoogleAPIService.fetchQuota(current.token.access_token);
          await CloudAccountRepo.updateQuota(current.id, quota);

          const updated = await CloudAccountRepo.getAccount(current.id);
          if (updated) updateTrayMenu(updated, lastLanguage);

          if (globalMainWindow) {
            globalMainWindow.webContents.send('tray://refresh-current');
          }
        } catch (e) {
          logger.error('Tray: Refresh quota failed', e);
        }
      },
    },
  ];
}

async function buildCodexMenu(
  texts: ReturnType<typeof getTrayTexts>,
): Promise<Electron.MenuItemConstructorOptions[]> {
  const status = await ManagedIdeService.getCurrentStatus({
    targetId: 'vscode-codex',
    refresh: false,
  });
  const quotaLines = getCodexQuotaText(status, texts);

  return [
    {
      label: `${texts.target}: VS Code Codex`,
      enabled: false,
    },
    {
      label: `${texts.current}: ${status.session.email || texts.no_session}`,
      enabled: false,
    },
    ...quotaLines.map((line) => ({ label: line, enabled: false })),
    { type: 'separator' },
    {
      label: texts.refresh_status,
      click: async () => {
        try {
          await ManagedIdeService.refreshCurrentStatus('vscode-codex');
          updateTrayMenu(undefined, lastLanguage);
        } catch (error) {
          logger.error('Tray: Failed to refresh VS Code Codex status', error);
        }
      },
    },
    {
      label: texts.open_ide,
      click: async () => {
        try {
          await ManagedIdeService.openIde('vscode-codex');
        } catch (error) {
          logger.error('Tray: Failed to open VS Code', error);
        }
      },
    },
    {
      label: texts.open_login,
      click: async () => {
        try {
          await ManagedIdeService.openLoginGuidance('vscode-codex');
        } catch (error) {
          logger.error('Tray: Failed to open Codex login guidance', error);
        }
      },
    },
  ];
}

export function initTray(mainWindow: BrowserWindow) {
  globalMainWindow = mainWindow;

  // PATCH 3: Destroy existing tray before creating new one (prevents zombie tray icons)
  if (tray) {
    try {
      tray.destroy();
    } catch (e) {
      logger.error('Failed to destroy existing tray', e);
    }
    tray = null;
    logger.info('Destroyed existing tray before creating new one');
  }

  const inDevelopment = process.env.NODE_ENV === 'development';
  // In production, extraResource copies 'src/assets' folder to 'resources/assets'
  const iconPath = inDevelopment
    ? path.join(process.cwd(), 'src/assets/tray.png')
    : path.join(process.resourcesPath, 'assets', 'tray.png');

  logger.info(
    `Tray icon path: ${iconPath}, inDevelopment: ${inDevelopment}, resourcesPath: ${process.resourcesPath}`,
  );

  const icon = nativeImage.createFromPath(iconPath);

  // Verify icon is valid before creating tray
  if (icon.isEmpty()) {
    logger.error(`Tray icon not found or invalid at path: ${iconPath}`);
    return;
  }

  tray = new Tray(icon);
  tray.setToolTip(MANAGER_PRODUCT_NAME);

  tray.on('double-click', () => {
    if (globalMainWindow) {
      if (globalMainWindow.isVisible()) {
        globalMainWindow.hide();
      } else {
        globalMainWindow.show();
        globalMainWindow.focus();
      }
    }
  });

  updateTrayMenu(null);
}

export function updateTrayMenu(account?: CloudAccount | null, language?: string) {
  if (account !== undefined) {
    lastAccount = account;
  }
  if (language) {
    lastLanguage = language;
  }

  if (!tray || !globalMainWindow) return;

  void (async () => {
    const texts = getTrayTexts(lastLanguage);
    const targetId = ConfigManager.getCachedConfigOrLoad().managed_ide_target;
    const bodyTemplate =
      targetId === 'vscode-codex'
        ? await buildCodexMenu(texts)
        : buildAntigravityMenu(lastAccount, texts);

    const template: Electron.MenuItemConstructorOptions[] = [
      ...bodyTemplate,
      ...buildUpdateMenuItems(lastUpdateStatus, texts, () => {
        void import('../../services/AppUpdateService')
          .then(({ AppUpdateService }) => {
            AppUpdateService.installDownloadedUpdate();
          })
          .catch((error) => {
            logger.error('Tray: Failed to trigger update installation', error);
          });
      }),
      { type: 'separator' },
      {
        label: texts.show_window,
        click: () => {
          globalMainWindow?.show();
          globalMainWindow?.focus();
        },
      },
      { type: 'separator' },
      {
        label: texts.quit,
        click: () => {
          app.quit();
        },
      },
    ];

    const menu = Menu.buildFromTemplate(template);
    tray.setContextMenu(menu);
  })().catch((error) => {
    logger.error('Failed to rebuild tray menu', error);
  });
}

export function setTrayLanguage(lang: string) {
  updateTrayMenu(undefined, lang);
}

export function setTrayUpdateStatus(status: AppUpdateStatus | null) {
  lastUpdateStatus = status;
  updateTrayMenu();
}

export function destroyTray() {
  lastUpdateStatus = null;
  if (tray) {
    try {
      tray.destroy();
    } catch (e) {
      logger.error('Failed to destroy tray', e);
    }
    tray = null;
    logger.info('Tray destroyed');
  }
}
