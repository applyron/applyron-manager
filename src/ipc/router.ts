import { app } from './app';
import { theme } from './theme';
import { window } from './window';
import { databaseRouter } from './database/router';
import { accountRouter } from './account/router';
import { cloudRouter } from './cloud/router';
import { configRouter } from './config/router';
import { gatewayRouter } from './gateway/router';
import { managedIdeRouter } from './managedIde/router';
import { operationsRouter } from './operations';

import { os } from '@orpc/server';
import { z } from 'zod';
import {
  isProcessRunning,
  closeAntigravity,
  startAntigravity,
  closeManagedIde,
  startManagedIde,
} from './process/handler';
import { systemHandler } from './system/handler';
import { logger } from '../utils/logger';

const ManagedIdeTargetInputSchema = z
  .object({
    targetId: z.enum(['antigravity', 'vscode-codex']).optional(),
  })
  .nullish();

// Log middleware setup
const logMiddleware = os.middleware(async (opts: any) => {
  const { next, path, meta } = opts;
  const requestPath = path || meta?.path || 'unknown';

  try {
    const result = await next({});
    return result;
  } catch (err) {
    logger.error(`[ORPC] Error in handler for ${JSON.stringify(requestPath)}:`, err);
    throw err;
  }
});

// Explicit Router Definition
export const router = os.use(logMiddleware).router({
  ping: os.output(z.string()).handler(async () => 'pong'),

  theme,
  window,
  app,
  database: databaseRouter,

  // Inline process router to ensure structure
  proc: os.router({
    isProcessRunning: os
      .input(ManagedIdeTargetInputSchema)
      .output(z.boolean())
      .handler(async ({ input }) => {
        return await isProcessRunning(input?.targetId);
      }),
    closeManagedIde: os
      .input(ManagedIdeTargetInputSchema)
      .output(z.void())
      .handler(async ({ input }) => {
        await closeManagedIde(input?.targetId);
      }),
    startManagedIde: os
      .input(ManagedIdeTargetInputSchema)
      .output(z.void())
      .handler(async ({ input }) => {
        await startManagedIde(input?.targetId);
      }),
    closeAntigravity: os.output(z.void()).handler(async () => {
      await closeAntigravity();
    }),
    startAntigravity: os.output(z.void()).handler(async () => {
      await startAntigravity();
    }),
  }),

  account: accountRouter,
  cloud: cloudRouter,
  config: configRouter,
  gateway: gatewayRouter,
  operations: operationsRouter,
  managedIde: managedIdeRouter,
  system: systemHandler,
});
