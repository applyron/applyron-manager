/**
 * Gateway ORPC Router
 * Provides routes for controlling the API Gateway service
 */
import { os } from '@orpc/server';
import { z } from 'zod';
import {
  startGateway,
  stopGateway,
  getGatewayStatus,
  getGatewayDiagnostics,
  generateApiKey,
} from './handlers';
import { ProxyDiagnosticsSnapshotSchema } from '../../types/operations';

export const gatewayRouter = os.prefix('/gateway').router({
  start: os
    .input(z.object({ port: z.number().min(1024).max(65535) }))
    .handler(async ({ input }) => {
      const success = await startGateway(input.port);
      if (!success) {
        throw new Error('Failed to start gateway');
      }
      return { success };
    }),

  stop: os.handler(async () => {
    const success = await stopGateway();
    if (!success) {
      throw new Error('Failed to stop gateway');
    }
    return { success };
  }),

  status: os.handler(async () => {
    return getGatewayStatus();
  }),

  getDiagnostics: os.output(ProxyDiagnosticsSnapshotSchema).handler(async () => {
    return getGatewayDiagnostics();
  }),

  generateKey: os.handler(async () => {
    const newKey = await generateApiKey();
    return { api_key: newKey };
  }),
});
