export interface UpstreamErrorHeaders {
  retryAfter?: string;
}

export class UpstreamRequestError extends Error {
  readonly status?: number;
  readonly headers?: UpstreamErrorHeaders;
  readonly body?: string;

  constructor(params: {
    message: string;
    status?: number;
    headers?: UpstreamErrorHeaders;
    body?: string;
  }) {
    super(params.message);
    this.name = 'UpstreamRequestError';
    this.status = params.status;
    this.headers = params.headers;
    this.body = params.body;
  }
}

export class ProxyCapacityError extends Error {
  readonly status: number;
  readonly retryAfterSec: number;
  readonly reason: string;

  constructor(params: { message: string; reason: string; retryAfterSec: number; status?: number }) {
    super(params.message);
    this.name = 'ProxyCapacityError';
    this.status = params.status ?? 503;
    this.retryAfterSec = params.retryAfterSec;
    this.reason = params.reason;
  }
}
