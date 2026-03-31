import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'crypto';
import {
  ApplyronPortableExportEnvelope,
  ApplyronPortableExportEnvelopeSchema,
  ApplyronPortableExportPayload,
  ApplyronPortableExportPayloadSchema,
} from '../types/operations';

const PORTABLE_BUNDLE_ITERATIONS = 210_000;
const PORTABLE_BUNDLE_KEY_LENGTH = 32;
const PORTABLE_BUNDLE_IV_LENGTH = 12;
const PORTABLE_BUNDLE_SALT_LENGTH = 16;
const PORTABLE_BUNDLE_VERSION = 'ApplyronPortableExportV1';

function derivePortableKey(password: string, salt: Buffer, iterations: number): Buffer {
  return pbkdf2Sync(password, salt, iterations, PORTABLE_BUNDLE_KEY_LENGTH, 'sha256');
}

export function createPortableExportEnvelope(input: {
  password: string;
  payload: ApplyronPortableExportPayload;
}): ApplyronPortableExportEnvelope {
  const salt = randomBytes(PORTABLE_BUNDLE_SALT_LENGTH);
  const iv = randomBytes(PORTABLE_BUNDLE_IV_LENGTH);
  const key = derivePortableKey(input.password, salt, PORTABLE_BUNDLE_ITERATIONS);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(input.payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: PORTABLE_BUNDLE_VERSION,
    exportedAt: input.payload.exportedAt,
    appVersion: input.payload.appVersion,
    kdf: {
      algorithm: 'PBKDF2-SHA256',
      iterations: PORTABLE_BUNDLE_ITERATIONS,
      keyLength: PORTABLE_BUNDLE_KEY_LENGTH,
    },
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function readPortableExportEnvelope(input: {
  password: string;
  envelope: unknown;
}): ApplyronPortableExportPayload {
  const envelope = ApplyronPortableExportEnvelopeSchema.parse(input.envelope);
  const salt = Buffer.from(envelope.salt, 'base64');
  const iv = Buffer.from(envelope.iv, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  const key = derivePortableKey(input.password, salt, envelope.kdf.iterations);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return ApplyronPortableExportPayloadSchema.parse(JSON.parse(plaintext.toString('utf8')));
}
