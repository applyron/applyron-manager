import { Injectable } from '@nestjs/common';
import type { ProxyMetricsSnapshot } from '../../../types/operations';

type RecordRequestInput = {
  model?: string | null;
  latencyMs: number;
  success: boolean;
  isStream?: boolean;
  isCapacityReject?: boolean;
  isRateLimitEvent?: boolean;
  errorMessage?: string | null;
};

const EMPTY_SNAPSHOT: ProxyMetricsSnapshot = {
  totalRequests: 0,
  successResponses: 0,
  errorResponses: 0,
  capacityRejects: 0,
  rateLimitEvents: 0,
  streamRequests: 0,
  avgLatencyMs: 0,
  lastRequestAt: null,
  lastError: null,
  modelBreakdown: {},
};

@Injectable()
export class ProxyMetricsRegistry {
  private totalLatencyMs = 0;
  private snapshot: ProxyMetricsSnapshot = { ...EMPTY_SNAPSHOT };

  reset(): void {
    this.totalLatencyMs = 0;
    this.snapshot = { ...EMPTY_SNAPSHOT, modelBreakdown: {} };
  }

  recordRequest(input: RecordRequestInput): void {
    this.snapshot.totalRequests += 1;
    this.snapshot.lastRequestAt = Date.now();

    if (input.success) {
      this.snapshot.successResponses += 1;
    } else {
      this.snapshot.errorResponses += 1;
      this.snapshot.lastError = input.errorMessage?.trim() || this.snapshot.lastError;
    }

    if (input.isStream) {
      this.snapshot.streamRequests += 1;
    }

    if (input.isCapacityReject) {
      this.snapshot.capacityRejects += 1;
    }

    if (input.isRateLimitEvent) {
      this.snapshot.rateLimitEvents += 1;
    }

    const model = input.model?.trim();
    if (model) {
      this.snapshot.modelBreakdown[model] = (this.snapshot.modelBreakdown[model] ?? 0) + 1;
    }

    this.totalLatencyMs += Math.max(0, input.latencyMs);
    this.snapshot.avgLatencyMs = Number(
      (this.totalLatencyMs / Math.max(1, this.snapshot.totalRequests)).toFixed(2),
    );
  }

  getSnapshot(): ProxyMetricsSnapshot {
    return {
      ...this.snapshot,
      modelBreakdown: { ...this.snapshot.modelBreakdown },
    };
  }
}
