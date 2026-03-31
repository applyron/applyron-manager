import { X509Certificate, createHash } from 'crypto';
import { logger as defaultLogger } from '@/utils/logger';

export const TRUSTED_UPDATE_SPKI_PINS = Object.freeze([
  '8cASx0PBh2ziickhbVPT6g9GkYWFqV/TPzp+q2rXcbc=',
  'kZwN96eHtZftBWrOZUsd6cA4es80n3NzSk/XtYz2EqQ=',
]);

export type CertificateVerifyDecision = 'use-chromium' | 'reject';

export interface UpdateCertificateLike {
  data?: string;
  fingerprint256?: string;
  issuerCert?: UpdateCertificateLike | null;
}

export interface UpdateCertificateVerifyRequestLike {
  hostname: string;
  verificationResult?: string;
  certificate?: UpdateCertificateLike;
}

export interface UpdateSessionLike {
  setCertificateVerifyProc(
    proc: (
      request: UpdateCertificateVerifyRequestLike,
      callback: (verificationResult: number) => void,
    ) => void,
  ): void;
}

export interface UpdateAppLike {
  on(event: 'session-created', listener: (session: UpdateSessionLike) => void): unknown;
}

interface UpdateCertificatePinningLogger {
  info(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export function computeSpkiSha256FromCertificatePem(pem: string): string {
  const certificate = new X509Certificate(pem);
  const spki = certificate.publicKey.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(spki).digest('base64');
}

export function collectCertificatePins(
  certificate: UpdateCertificateLike | null | undefined,
  extractor: (pem: string) => string = computeSpkiSha256FromCertificatePem,
): string[] {
  const pins = new Set<string>();
  const visited = new Set<UpdateCertificateLike>();
  let current = certificate ?? null;

  while (current && !visited.has(current)) {
    visited.add(current);

    if (typeof current.data === 'string' && current.data.trim()) {
      pins.add(extractor(current.data));
    }

    if (!current.issuerCert || current.issuerCert === current) {
      break;
    }

    current = current.issuerCert;
  }

  return Array.from(pins);
}

export function evaluatePinnedUpdateCertificate(
  {
    hostname,
    verificationResult,
    certificate,
    trustedHost,
    allowedPins,
  }: {
    hostname: string;
    verificationResult?: string;
    certificate?: UpdateCertificateLike;
    trustedHost: string;
    allowedPins: readonly string[];
  },
  extractor: (pem: string) => string = computeSpkiSha256FromCertificatePem,
): CertificateVerifyDecision {
  if (hostname.trim().toLowerCase() !== trustedHost.trim().toLowerCase()) {
    return 'use-chromium';
  }

  if (verificationResult !== 'OK') {
    return 'reject';
  }

  const presentedPins = collectCertificatePins(certificate, extractor);
  return presentedPins.some((pin) => allowedPins.includes(pin)) ? 'use-chromium' : 'reject';
}

export function installUpdateCertificatePinning({
  app,
  defaultSession,
  trustedHost,
  allowedPins = TRUSTED_UPDATE_SPKI_PINS,
  logger = defaultLogger,
}: {
  app: UpdateAppLike;
  defaultSession: UpdateSessionLike | null | undefined;
  trustedHost: string;
  allowedPins?: readonly string[];
  logger?: UpdateCertificatePinningLogger;
}) {
  const normalizedHost = trustedHost.trim().toLowerCase();
  if (!normalizedHost) {
    throw new Error('Automatic updates are disabled because the trusted update host is empty.');
  }

  const normalizedPins = Array.from(new Set(allowedPins.map((pin) => pin.trim()).filter(Boolean)));
  if (normalizedPins.length < 2) {
    throw new Error(
      'Automatic updates are disabled because the update certificate pin set is incomplete.',
    );
  }

  if (!defaultSession || typeof defaultSession.setCertificateVerifyProc !== 'function') {
    throw new Error(
      'Automatic updates are disabled because the certificate verifier is unavailable.',
    );
  }

  const verifyProc = (
    request: UpdateCertificateVerifyRequestLike,
    callback: (verificationResult: number) => void,
  ) => {
    const requestHost = request.hostname.trim().toLowerCase();

    try {
      const decision = evaluatePinnedUpdateCertificate(
        {
          hostname: requestHost,
          verificationResult: request.verificationResult,
          certificate: request.certificate,
          trustedHost: normalizedHost,
          allowedPins: normalizedPins,
        },
        computeSpkiSha256FromCertificatePem,
      );

      if (decision === 'reject') {
        logger.error('Rejected update certificate that did not match the trusted pin set.', {
          trustedHost: normalizedHost,
          hostname: requestHost,
          verificationResult: request.verificationResult ?? null,
        });
        callback(-2);
        return;
      }

      callback(-3);
    } catch (error) {
      if (requestHost === normalizedHost) {
        logger.error('Failed to verify the trusted update certificate chain.', error);
        callback(-2);
        return;
      }

      callback(-3);
    }
  };

  defaultSession.setCertificateVerifyProc(verifyProc);
  app.on('session-created', (createdSession) => {
    createdSession.setCertificateVerifyProc(verifyProc);
  });

  logger.info('Installed update certificate pinning.', {
    trustedHost: normalizedHost,
    pinCount: normalizedPins.length,
  });

  return verifyProc;
}
