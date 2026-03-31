import { os } from '@orpc/server';
import { z } from 'zod';
import {
  ActivityEventCategorySchema,
  ActivityEventListResultSchema,
  FilePickerResultSchema,
  ImportApplyResultSchema,
  ImportPreviewSummarySchema,
} from '../../types/operations';
import {
  exportBundle,
  importBundleApply,
  importBundlePreview,
  listActivityEvents,
  pickExportBundlePath,
  pickImportBundleFile,
} from './handlers';

const filePickerInputSchema = z
  .object({
    defaultDirectory: z.string().nullable().optional(),
  })
  .nullish();

export const operationsRouter = os.router({
  pickExportBundlePath: os
    .input(filePickerInputSchema)
    .output(FilePickerResultSchema)
    .handler(async ({ input }) => {
      return pickExportBundlePath(input ?? undefined);
    }),

  pickImportBundleFile: os
    .input(filePickerInputSchema)
    .output(FilePickerResultSchema)
    .handler(async ({ input }) => {
      return pickImportBundleFile(input ?? undefined);
    }),

  listActivityEvents: os
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).optional(),
          offset: z.number().int().min(0).optional(),
          categories: z.array(ActivityEventCategorySchema).optional(),
        })
        .nullish(),
    )
    .output(ActivityEventListResultSchema)
    .handler(async ({ input }) => {
      return listActivityEvents(input ?? undefined);
    }),

  exportBundle: os
    .input(
      z.object({
        filePath: z.string().min(1),
        password: z.string().min(1),
      }),
    )
    .output(
      z.object({
        filePath: z.string(),
        counts: z.object({
          legacy: z.number(),
          cloud: z.number(),
          codex: z.number(),
        }),
      }),
    )
    .handler(async ({ input }) => {
      return exportBundle(input);
    }),

  importBundle: os
    .input(
      z.union([
        z.object({
          mode: z.literal('preview'),
          filePath: z.string().min(1),
          password: z.string().min(1),
        }),
        z.object({
          mode: z.literal('apply'),
          previewId: z.string().min(1),
        }),
      ]),
    )
    .output(z.union([ImportPreviewSummarySchema, ImportApplyResultSchema]))
    .handler(async ({ input }) => {
      if (input.mode === 'preview') {
        return importBundlePreview(input);
      }

      return importBundleApply(input);
    }),
});
