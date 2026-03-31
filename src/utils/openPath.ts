import { shell } from 'electron';

export class OpenPathError extends Error {
  readonly context: string;
  readonly detail: string;

  constructor(context: string, detail: string) {
    super(`Failed to open ${context}: ${detail}`);
    this.name = 'OpenPathError';
    this.context = context;
    this.detail = detail;
  }
}

export async function openPathOrThrow(targetPath: string, context: string): Promise<void> {
  const result = await shell.openPath(targetPath);
  if (result) {
    throw new OpenPathError(context, result);
  }
}
