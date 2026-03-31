import fs from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '../utils/logger';
import type { CodexAuthFile } from './types';
import { CodexAuthFileSchema } from './schemas';

export function getCodexHomePath(): string {
  const override = process.env.CODEX_HOME?.trim();
  return override && override.length > 0 ? override : path.join(os.homedir(), '.codex');
}

export function getCodexAuthFilePath(codexHome = getCodexHomePath()): string {
  return path.join(codexHome, 'auth.json');
}

export function readCodexAuthFile(filePath = getCodexAuthFilePath()): CodexAuthFile | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    const result = CodexAuthFileSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function writeCodexAuthFile(
  authFile: CodexAuthFile,
  filePath = getCodexAuthFilePath(),
): void {
  const targetDir = path.dirname(filePath);
  fs.mkdirSync(targetDir, { recursive: true });
  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;

  try {
    fs.writeFileSync(tempPath, JSON.stringify(authFile, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Ignore temp cleanup failures.
    }
    throw error;
  }
}

export function removeCodexAuthFile(filePath = getCodexAuthFilePath()): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch (error) {
    logger.warn('Failed to remove Codex auth file', error);
  }
}

export function decodeJwtClaims(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) {
    return null;
  }

  const segments = token.split('.');
  if (segments.length < 2) {
    return null;
  }

  try {
    const base64 = segments[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(segments[1].length / 4) * 4, '=');
    const payload = Buffer.from(base64, 'base64').toString('utf8');
    const parsed = JSON.parse(payload) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function getCodexEmailHint(authFile: CodexAuthFile | null): string | null {
  if (!authFile?.tokens) {
    return null;
  }

  const idTokenClaims = decodeJwtClaims(authFile.tokens.id_token);
  if (typeof idTokenClaims?.email === 'string' && idTokenClaims.email.trim().length > 0) {
    return idTokenClaims.email.trim();
  }

  const accessTokenClaims = decodeJwtClaims(authFile.tokens.access_token);
  if (typeof accessTokenClaims?.email === 'string' && accessTokenClaims.email.trim().length > 0) {
    return accessTokenClaims.email.trim();
  }

  return null;
}
