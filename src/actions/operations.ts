import { ipc } from '@/ipc/manager';
import type {
  ActivityEventCategory,
  ActivityEventListResult,
  FilePickerResult,
  ImportApplyResult,
  ImportPreviewSummary,
} from '@/types/operations';

export function pickExportBundlePath(input?: {
  defaultDirectory?: string | null;
}): Promise<FilePickerResult> {
  return ipc.client.operations.pickExportBundlePath(input ?? null);
}

export function pickImportBundleFile(input?: {
  defaultDirectory?: string | null;
}): Promise<FilePickerResult> {
  return ipc.client.operations.pickImportBundleFile(input ?? null);
}

export function listActivityEvents(input?: {
  limit?: number;
  offset?: number;
  categories?: ActivityEventCategory[];
}): Promise<ActivityEventListResult> {
  return ipc.client.operations.listActivityEvents(input ?? null);
}

export function exportBundle(input: { filePath: string; password: string }): Promise<{
  filePath: string;
  counts: {
    legacy: number;
    cloud: number;
    codex: number;
  };
}> {
  return ipc.client.operations.exportBundle(input);
}

export function previewImportBundle(input: {
  filePath: string;
  password: string;
}): Promise<ImportPreviewSummary> {
  return ipc.client.operations.importBundle({
    mode: 'preview',
    filePath: input.filePath,
    password: input.password,
  }) as Promise<ImportPreviewSummary>;
}

export function applyImportBundle(input: { previewId: string }): Promise<ImportApplyResult> {
  return ipc.client.operations.importBundle({
    mode: 'apply',
    previewId: input.previewId,
  }) as Promise<ImportApplyResult>;
}
