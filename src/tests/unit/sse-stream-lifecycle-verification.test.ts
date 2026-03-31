import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GeminiController } from '../../server/modules/proxy/gemini.controller';
import { ProxyController } from '../../server/modules/proxy/proxy.controller';

class MockRawReply extends EventEmitter {
  writableEnded = false;
  writeHead = vi.fn();
  write = vi.fn();
  end = vi.fn(() => {
    this.writableEnded = true;
  });
}

function createReply() {
  const raw = new MockRawReply();
  return {
    raw,
    hijack: vi.fn(),
    header: vi.fn(),
    send: vi.fn(),
    status: vi.fn().mockReturnThis(),
  };
}

function createStream(unsubscribe: ReturnType<typeof vi.fn>) {
  return {
    subscribe: vi.fn(() => ({
      unsubscribe,
    })),
  };
}

describe('SSE stream lifecycle verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ProxyController unsubscribes exactly once on response close', () => {
    const controller = new ProxyController({} as never, undefined);
    const unsubscribe = vi.fn();
    const reply = createReply();

    (
      controller as unknown as { writeSseResponse: (res: unknown, stream: unknown) => void }
    ).writeSseResponse(reply, createStream(unsubscribe));

    expect(reply.raw.listenerCount('close')).toBe(1);

    reply.raw.emit('close');

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(reply.raw.writeHead).toHaveBeenCalledTimes(1);
  });

  it('GeminiController unsubscribes exactly once on response close', () => {
    const controller = new GeminiController({} as never, undefined);
    const unsubscribe = vi.fn();
    const reply = createReply();

    (
      controller as unknown as {
        writeObservableSseResponse: (res: unknown, stream: unknown) => void;
      }
    ).writeObservableSseResponse(reply, createStream(unsubscribe));

    expect(reply.raw.listenerCount('close')).toBe(1);

    reply.raw.emit('close');

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(reply.raw.writeHead).toHaveBeenCalledTimes(1);
  });

  it('does not accumulate multiple close listeners per response across repeated SSE requests', () => {
    const proxyController = new ProxyController({} as never, undefined);
    const geminiController = new GeminiController({} as never, undefined);
    const proxyUnsubscribes: Array<ReturnType<typeof vi.fn>> = [];
    const geminiUnsubscribes: Array<ReturnType<typeof vi.fn>> = [];

    for (let index = 0; index < 50; index += 1) {
      const proxyReply = createReply();
      const geminiReply = createReply();
      const proxyUnsubscribe = vi.fn();
      const geminiUnsubscribe = vi.fn();
      proxyUnsubscribes.push(proxyUnsubscribe);
      geminiUnsubscribes.push(geminiUnsubscribe);

      (
        proxyController as unknown as { writeSseResponse: (res: unknown, stream: unknown) => void }
      ).writeSseResponse(proxyReply, createStream(proxyUnsubscribe));
      (
        geminiController as unknown as {
          writeObservableSseResponse: (res: unknown, stream: unknown) => void;
        }
      ).writeObservableSseResponse(geminiReply, createStream(geminiUnsubscribe));

      expect(proxyReply.raw.listenerCount('close')).toBe(1);
      expect(geminiReply.raw.listenerCount('close')).toBe(1);

      proxyReply.raw.emit('close');
      geminiReply.raw.emit('close');
    }

    for (const unsubscribe of proxyUnsubscribes) {
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    }
    for (const unsubscribe of geminiUnsubscribes) {
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    }
  });
});
