import { ORPCError, os } from '@orpc/server';
import { z } from 'zod';
import { ManagedIdeService } from '../../managedIde/service';
import {
  CodexAccountRecordSchema,
  ManagedIdeCurrentStatusSchema,
  ManagedIdeRuntimeTargetSchema,
} from '../../managedIde/schemas';
import { isCloudStorageUnavailableError } from '../database/cloudHandler';
import { ActivityLogService } from '../../services/ActivityLogService';

const ManagedIdeTargetIdSchema = z.enum(['antigravity', 'vscode-codex']);

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

  addCodexAccount: os.output(CodexAccountRecordSchema).handler(async () => {
    try {
      const account = await ManagedIdeService.addCodexAccount();
      ActivityLogService.record({
        category: 'codex',
        action: 'add',
        target: account.email ?? account.accountId,
        outcome: 'success',
        message: 'Codex account added.',
        metadata: { accountId: account.accountId },
      });
      return account;
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
        target: account.email ?? account.accountId,
        outcome: 'success',
        message: 'Codex session imported.',
        metadata: { accountId: account.accountId },
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
        accountId: z.string().min(1),
      }),
    )
    .output(CodexAccountRecordSchema)
    .handler(async ({ input }) => {
      try {
        const account = await ManagedIdeService.refreshCodexAccount(input.accountId);
        ActivityLogService.record({
          category: 'codex',
          action: 'refresh',
          target: account.email ?? account.accountId,
          outcome: 'success',
          message: 'Codex account refreshed.',
          metadata: { accountId: account.accountId },
        });
        return account;
      } catch (error) {
        ActivityLogService.record({
          category: 'codex',
          action: 'refresh',
          target: input.accountId,
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
        accountId: z.string().min(1),
      }),
    )
    .output(CodexAccountRecordSchema)
    .handler(async ({ input }) => {
      try {
        const account = await ManagedIdeService.activateCodexAccount(input.accountId);
        ActivityLogService.record({
          category: 'codex',
          action: 'activate',
          target: account.email ?? account.accountId,
          outcome: 'success',
          message: 'Codex account activated.',
          metadata: { accountId: account.accountId },
        });
        return account;
      } catch (error) {
        ActivityLogService.record({
          category: 'codex',
          action: 'activate',
          target: input.accountId,
          outcome: 'failure',
          message: error instanceof Error ? error.message : 'Codex activate failed.',
        });
        throw toManagedIdeRpcError(error);
      }
    }),

  deleteCodexAccount: os
    .input(
      z.object({
        accountId: z.string().min(1),
      }),
    )
    .output(z.void())
    .handler(async ({ input }) => {
      try {
        await ManagedIdeService.deleteCodexAccount(input.accountId);
        ActivityLogService.record({
          category: 'codex',
          action: 'delete',
          target: input.accountId,
          outcome: 'success',
          message: 'Codex account deleted.',
        });
      } catch (error) {
        ActivityLogService.record({
          category: 'codex',
          action: 'delete',
          target: input.accountId,
          outcome: 'failure',
          message: error instanceof Error ? error.message : 'Codex delete failed.',
        });
        throw toManagedIdeRpcError(error);
      }
    }),
});
