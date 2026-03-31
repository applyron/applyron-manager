import type { SupportedMessagePort } from '@orpc/client/message-port';
import { logger } from '../utils/logger';
import { ServiceHealthRegistry } from '../services/ServiceHealthRegistry';

export type OrpcMessagePortLike = SupportedMessagePort & {
  start(): void;
  close?: () => void;
};

export interface AttachOrpcTransportInput {
  senderId: number;
  port: OrpcMessagePortLike | null | undefined;
  upgrade: (port: OrpcMessagePortLike) => void;
  onMessage?: (data: unknown) => void;
}

interface ActiveOrpcTransport {
  senderId: number;
  port: OrpcMessagePortLike;
}

export class OrpcTransportManager {
  private activeTransport: ActiveOrpcTransport | null = null;

  attach(input: AttachOrpcTransportInput): 'attached' | 'replaced' {
    const { senderId, port, upgrade, onMessage } = input;
    if (!port) {
      ServiceHealthRegistry.markError(
        'orpc_transport',
        'Renderer did not provide a transport port.',
      );
      throw new Error('ORPC transport port was not provided.');
    }

    if (this.activeTransport && this.activeTransport.senderId !== senderId) {
      this.closePort(port);
      const message = `Rejected duplicate ORPC init from sender ${senderId}; owner is ${this.activeTransport.senderId}.`;
      ServiceHealthRegistry.markError('orpc_transport', message);
      throw new Error(message);
    }

    const wasReplace = Boolean(this.activeTransport);
    if (this.activeTransport) {
      this.closePort(this.activeTransport.port);
      this.activeTransport = null;
    }

    const portWithMessageListener = port as Partial<{
      on: (event: 'message', listener: (event: { data: unknown }) => void) => void;
    }>;

    if (onMessage && typeof portWithMessageListener.on === 'function') {
      portWithMessageListener.on('message', (event) => {
        onMessage(event.data);
      });
    }

    port.start();

    try {
      upgrade(port);
      this.activeTransport = { senderId, port };
      ServiceHealthRegistry.markReady('orpc_transport', `Bound to renderer ${senderId}.`);
      return wasReplace ? 'replaced' : 'attached';
    } catch (error) {
      this.closePort(port);
      this.activeTransport = null;
      const message = error instanceof Error ? error.message : 'Failed to attach ORPC transport.';
      ServiceHealthRegistry.markError('orpc_transport', message);
      throw error;
    }
  }

  releaseForSender(senderId: number, reason?: string): void {
    if (!this.activeTransport || this.activeTransport.senderId !== senderId) {
      return;
    }

    this.closePort(this.activeTransport.port);
    this.activeTransport = null;
    ServiceHealthRegistry.markIdle('orpc_transport', reason ?? 'Renderer transport released.');
  }

  reset(reason?: string): void {
    if (this.activeTransport) {
      this.closePort(this.activeTransport.port);
      this.activeTransport = null;
    }

    ServiceHealthRegistry.markIdle('orpc_transport', reason ?? null);
  }

  getOwnerSenderId(): number | null {
    return this.activeTransport?.senderId ?? null;
  }

  private closePort(port: OrpcMessagePortLike): void {
    try {
      port.close?.();
    } catch (error) {
      logger.warn('Failed to close ORPC message port', error);
    }
  }
}
