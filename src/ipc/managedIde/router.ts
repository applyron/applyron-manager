import { ORPCError, os } from '@orpc/server';
import { z } from 'zod';
import {
  getCodexAccountDisplayIdentity,
  getCodexWorkspaceLabel,
} from '../../managedIde/codexIdentity';
import { ManagedIdeService } from '../../managedIde/service';
import {
  CodexAccountRecordSchema,
  CodexRuntimeSyncResultSchema,
  ManagedIdeCurrentStatusSchema,
  ManagedIdeRuntimeTargetSchema,
} from '../../managedIde/schemas';
import { isCloudStorageUnavailableError } from '../database/cloudHandler';
import { ActivityLogService } from '../../services/ActivityLogService';

const ManagedIdeTargetIdSchema = z.enum(['antigravity', 'vscode-codex']);

function buildCodexActivityTarget(account: {
  accountId: string;
  email: string | null;
  label: string | null;
  workspace?: { title: string | null; id: string } | null;
}) {
  const identity = getCodexAccountDisplayIdentity(account);
  const workspaceLabel = getCodexWorkspaceLabel(account.workspace ?? null);

  if (workspaceLabel && account.email) {
    return `${account.email} (${workspaceLabel})`;
  }

  return identity;
}

function toManagedIdeRpcError(error: unknown): ORPCError<string, { reason: string }> {
  if (error instanceof ORPCError) {
    return error;
  }

  if (error instanceof Error) {
    if (
      error.message.startsWith('CODEX_') ||
      error.message === 'ACTIVE_CODEX_ACCOUNT_DELETE_BLOCKED'
    ) {
      return new ORPCError(error.message, {
        status: 500,
        message: error.message,
        data: { reason: error.message },
      });
    }

    if (isCloudStorageUnavailableError(error)) {
      return new ORPCError('CODEX_ACCOUNT_STORE_UNAVAILABLE', {
        status: 500,
        message: 'CODEX_ACCOUNT_STORE_UNAVAILABLE',
        data: { reason: 'CODEX_ACCOUNT_STORE_UNAVAILABLE' },
      });
    }
  }

  return new ORPCError('INTERNAL_SERVER_ERROR', {
    status: 500,
    message: 'Internal server error',
    data: { reason: 'INTERNAL_SERVER_ERROR' },
    cause: error instanceof Error ? error : undefined,
  });
}

export const managedIdeRouter = os.router({
  listTargets: os.output(z.array(ManagedIdeRuntimeTargetSchema)).handler(async () => {
    return ManagedIdeService.listTargets();
  }),

  getCurrentStatus: os
    .input(
      z
        .object({
          targetId: ManagedIdeTargetIdSchema.optional(),
          refresh: z.boolean().optional(),
        })
        .nullish(),
    )
    .output(ManagedIdeCurrentStatusSchema)
    .handler(async ({ input }) => {
      return ManagedIdeService.getCurrentStatus({
        targetId: input?.targetId,
        refresh: input?.refresh,
      });
    }),

  refreshCurrentStatus: os
    .input(
      z
        .object({
          targetId: ManagedIdeTargetIdSchema.optional(),
        })
        .nullish(),
    )
    .output(ManagedIdeCurrentStatusSchema)
    .handler(async ({ input }) => {
      return ManagedIdeService.refreshCurrentStatus(input?.targetId);
    }),

  importCurrentSession: os
    .input(
      z
        .object({
          targetId: ManagedIdeTargetIdSchema.optional(),
        })
        .nullish(),
    )
    .output(ManagedIdeCurrentStatusSchema)
    .handler(async ({ input }) => {
      return ManagedIdeService.importCurrentSession(input?.targetId);
    }),

  openIde: os
    .input(
      z
        .object({
          targetId: ManagedIdeTargetIdSchema.optional(),
        })
        .nullish(),
    )
    .output(z.void())
    .handler(async ({ input }) => {
      await ManagedIdeService.openIde(input?.targetId);
    }),

  openLoginGuidance: os
    .input(
      z
        .object({
          targetId: ManagedIdeTargetIdSchema.optional(),
        })
        .nullish(),
    )
    .output(z.void())
    .handler(async ({ input }) => {
      await ManagedIdeService.openLoginGuidance(input?.targetId);
    }),

  listCodexAccounts: os.output(z.array(CodexAccountRecordSchema)).handler(async () => {
    try {
      return await ManagedIdeService.listCodexAccounts();
    } catch (error) {
      throw toManagedIdeRpcError(error);
    }
  }),

  addCodexAccount: os.output(z.array(CodexAccountRecordSchema)).handler(async () => {
    try {
      const accounts = await ManagedIdeService.addCodexAccount();
      for (const account of accounts) {
        ActivityLogService.record({
          category: 'codex',
          action: 'add',
          target: buildCodexActivityTarget(account),
          outcome: 'success',
          message: 'Codex account added.',
          metadata: { accountId: account.accountId, workspaceId: account.workspace?.id ?? null },
        });
      }
      return accounts;
    } catch (error) {
      ActivityLogService.record({
        category: 'codex',
        action: 'add',
        target: 'codex',
        outcome: 'failure',
        message: error instanceof Error ? error.message : 'Codex add failed.',
      });
      throw toManagedIdeRpcError(error);
    }
  }),

  importCurrentCodexAccount: os.output(CodexAccountRecordSchema).handler(async () => {
    try {
      const account = await ManagedIdeService.importCurrentCodexAccount();
      ActivityLogService.record({
        category: 'codex',
        action: 'import',
        target: buildCodexActivityTarget(account),
        outcome: 'success',
        message: 'Codex session imported.',
        metadata: { accountId: account.accountId, workspaceId: account.workspace?.id ?? null },
      });
      return account;
    } catch (error) {
      ActivityLogService.record({
        category: 'codex',
        action: 'import',
        target: 'codex',
        outcome: 'failure',
        message: error instanceof Error ? error.message : 'Codex import failed.',
      });
      throw toManagedIdeRpcError(error);
    }
  }),

  refreshCodexAccount: os
    .input(
      z.object({
        id: z.string().min(1),
      }),
    )
    .output(CodexAccountRecordSchema)
    .handler(async ({ input }) => {
      try {
        const account = await ManagedIdeService.refreshCodexAccount(input.id);
        ActivityLogService.record({
          category: 'codex',
          action: 'refresh',
          target: buildCodexActivityTarget(account),
          outcome: 'success',
          message: 'Codex account refreshed.',
          metadata: { accountId: account.accountId, workspaceId: account.workspace?.id ?? null },
        });
        return account;
      } catch (error) {
        ActivityLogService.record({
          category: 'codex',
          action: 'refresh',
          target: input.id,
          outcome: 'failure',
          message: error instanceof Error ? error.message : 'Codex refresh failed.',
        });
        throw toManagedIdeRpcError(error);
      }
    }),

  refreshAllCodexAccounts: os.output(z.array(CodexAccountRecordSchema)).handler(async () => {
    try {
      const accounts = await ManagedIdeService.refreshAllCodexAccounts();
      ActivityLogService.record({
        category: 'codex',
        action: 'refresh-all',
        target: 'codex',
        outcome: 'success',
        message: 'All Codex accounts refreshed.',
        metadata: { count: accounts.length },
      });
      return accounts;
    } catch (error) {
      ActivityLogService.record({
        category: 'codex',
        action: 'refresh-all',
        target: 'codex',
        outcome: 'failure',
        message: error instanceof Error ? error.message : 'Codex refresh-all failed.',
      });
      throw toManagedIdeRpcError(error);
    }
  }),

  activateCodexAccount: os
    .input(
      z.object({
        id: z.string().min(1),
      }),
    )
    .output(CodexAccountRecordSchema)
    .handler(async ({ input }) => {
      try {
        const account = await ManagedIdeService.activateCodexAccount(input.id);
        ActivityLogService.record({
          category: 'codex',
          action: 'activate',
          target: buildCodexActivityTarget(account),
          outcome: 'success',
          message: 'Codex account activated.',
          metadata: { accountId: account.accountId, workspaceId: account.workspace?.id ?? null },
        });
        return account;
      } catch (error) {
        ActivityLogService.record({
          category: 'codex',
          action: 'activate',
          target: input.id,
          outcome: 'failure',
          message: error instanceof Error ? error.message : 'Codex activate failed.',
        });
        throw toManagedIdeRpcError(error);
      }
    }),

  deleteCodexAccount: os
    .input(
      z.object({
        id: z.string().min(1),
      }),
    )
    .output(z.void())
    .handler(async ({ input }) => {
      try {
        const existingAccount = (await ManagedIdeService.listCodexAccounts()).find(
          (account) => account.id === input.id,
        );
        await ManagedIdeService.deleteCodexAccount(input.id);
        ActivityLogService.record({
          category: 'codex',
          action: 'delete',
          target: existingAccount ? buildCodexActivityTarget(existingAccount) : input.id,
          outcome: 'success',
          message: 'Codex account deleted.',
          metadata: existingAccount
            ? {
                accountId: existingAccount.accountId,
                workspaceId: existingAccount.workspace?.id ?? null,
              }
            : { id: input.id },
        });
      } catch (error) {
        ActivityLogService.record({
          category: 'codex',
          action: 'delete',
          target: input.id,
          outcome: 'failure',
          message: error instanceof Error ? error.message : 'Codex delete failed.',
        });
        throw toManagedIdeRpcError(error);
      }
    }),

  syncCodexRuntimeState: os.output(CodexRuntimeSyncResultSchema).handler(async () => {
    try {
      const result = await ManagedIdeService.syncCodexRuntimeState();
      ActivityLogService.record({
        category: 'codex',
        action: 'sync-runtime',
        target: `${result.sourceRuntimeId}->${result.targetRuntimeId}`,
        outcome: result.warnings.length > 0 ? 'info' : 'success',
        message:
          result.warnings.length > 0
            ? `Codex runtime sync completed with warnings: ${result.warnings.join(', ')}`
            : 'Codex runtime sync completed.',
        metadata: {
          sourceRuntimeId: result.sourceRuntimeId,
          targetRuntimeId: result.targetRuntimeId,
          syncedAuthFile: result.syncedAuthFile,
          syncedExtensionState: result.syncedExtensionState,
        },
      });
      return result;
    } catch (error) {
      ActivityLogService.record({
        category: 'codex',
        action: 'sync-runtime',
        target: 'codex-runtime',
        outcome: 'failure',
        message: error instanceof Error ? error.message : 'Codex runtime sync failed.',
      });
      throw toManagedIdeRpcError(error);
    }
  }),
});
