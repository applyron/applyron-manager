import { enCommon } from './common';
import { enDashboard } from './dashboard';
import { enCloud } from './cloud';
import { enProxy } from './proxy';
import { enSettings } from './settings';
import { enManagedIde } from './managedIde';

export const enTranslation = {
  ...enCommon,
  ...enDashboard,
  ...enCloud,
  ...enProxy,
  ...enSettings,
  ...enManagedIde,
} as const;
