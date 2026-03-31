import { describe, expect, it, vi } from 'vitest';
import {
  collectCertificatePins,
  evaluatePinnedUpdateCertificate,
  installUpdateCertificatePinning,
} from '@/services/updateCertificatePinning';

describe('update certificate pinning', () => {
  it('collects pins across the certificate chain', () => {
    const certificate = {
      data: 'leaf-cert',
      issuerCert: {
        data: 'intermediate-cert',
        issuerCert: {
          data: 'root-cert',
          issuerCert: null,
        },
      },
    };

    const pins = collectCertificatePins(certificate, (pem) => `pin:${pem}`);

    expect(pins).toEqual(['pin:leaf-cert', 'pin:intermediate-cert', 'pin:root-cert']);
  });

  it('accepts the trusted host when the primary pin matches', () => {
    const decision = evaluatePinnedUpdateCertificate(
      {
        hostname: 'updates.applyron.com',
        verificationResult: 'OK',
        trustedHost: 'updates.applyron.com',
        allowedPins: ['primary-pin', 'backup-pin'],
        certificate: {
          data: 'leaf-cert',
          issuerCert: {
            data: 'intermediate-cert',
            issuerCert: null,
          },
        },
      },
      (pem) => (pem === 'leaf-cert' ? 'primary-pin' : `pin:${pem}`),
    );

    expect(decision).toBe('use-chromium');
  });

  it('accepts the trusted host when the backup pin matches', () => {
    const decision = evaluatePinnedUpdateCertificate(
      {
        hostname: 'updates.applyron.com',
        verificationResult: 'OK',
        trustedHost: 'updates.applyron.com',
        allowedPins: ['primary-pin', 'backup-pin'],
        certificate: {
          data: 'leaf-cert',
          issuerCert: {
            data: 'intermediate-cert',
            issuerCert: null,
          },
        },
      },
      (pem) => (pem === 'intermediate-cert' ? 'backup-pin' : `pin:${pem}`),
    );

    expect(decision).toBe('use-chromium');
  });

  it('rejects the trusted host when none of the pins match', () => {
    const decision = evaluatePinnedUpdateCertificate(
      {
        hostname: 'updates.applyron.com',
        verificationResult: 'OK',
        trustedHost: 'updates.applyron.com',
        allowedPins: ['primary-pin', 'backup-pin'],
        certificate: {
          data: 'leaf-cert',
          issuerCert: null,
        },
      },
      () => 'unexpected-pin',
    );

    expect(decision).toBe('reject');
  });

  it('rejects the trusted host when Chromium verification already failed', () => {
    const decision = evaluatePinnedUpdateCertificate(
      {
        hostname: 'updates.applyron.com',
        verificationResult: 'CERT_DATE_INVALID',
        trustedHost: 'updates.applyron.com',
        allowedPins: ['primary-pin', 'backup-pin'],
        certificate: {
          data: 'leaf-cert',
          issuerCert: null,
        },
      },
      () => 'primary-pin',
    );

    expect(decision).toBe('reject');
  });

  it('installs the verify proc on the default and future sessions', () => {
    const setDefaultVerifyProc = vi.fn();
    const setCreatedVerifyProc = vi.fn();
    const appOn = vi.fn(
      (
        _event: string,
        listener: (session: { setCertificateVerifyProc: typeof setCreatedVerifyProc }) => void,
      ) => {
        listener({ setCertificateVerifyProc: setCreatedVerifyProc });
      },
    );

    installUpdateCertificatePinning({
      app: {
        on: appOn,
      },
      defaultSession: {
        setCertificateVerifyProc: setDefaultVerifyProc,
      },
      trustedHost: 'updates.applyron.com',
      allowedPins: ['primary-pin', 'backup-pin'],
      logger: {
        info: vi.fn(),
        error: vi.fn(),
      },
    });

    expect(setDefaultVerifyProc).toHaveBeenCalledTimes(1);
    expect(appOn).toHaveBeenCalledWith('session-created', expect.any(Function));
    expect(setCreatedVerifyProc).toHaveBeenCalledTimes(1);
  });

  it('rejects an incomplete pin set before installing the verifier', () => {
    expect(() =>
      installUpdateCertificatePinning({
        app: {
          on: vi.fn(),
        },
        defaultSession: {
          setCertificateVerifyProc: vi.fn(),
        },
        trustedHost: 'updates.applyron.com',
        allowedPins: ['only-one-pin'],
        logger: {
          info: vi.fn(),
          error: vi.fn(),
        },
      }),
    ).toThrow(
      'Automatic updates are disabled because the update certificate pin set is incomplete.',
    );
  });
});
