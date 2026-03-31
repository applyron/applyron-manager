import { trCommon } from './common';
import { trDashboard } from './dashboard';
import { trCloud } from './cloud';
import { trProxy } from './proxy';
import { trSettings } from './settings';
import { trManagedIde } from './managedIde';

export const trTranslation = {
  ...trCommon,
  ...trDashboard,
  ...trCloud,
  ...trProxy,
  ...trSettings,
  ...trManagedIde,
} as const;
