import type {
  GeminiInternalRequest,
  GeminiPart as InternalGeminiPart,
} from '../../../lib/antigravity/types';
import type { ProxyConfig } from '../../../types/config';
import type { GeminiResponse } from './interfaces/request-interfaces';
import { isGeminiPart } from './proxy-routing-helpers';

export interface GeminiInternalTransport {
  generateInternal: (
    body: GeminiInternalRequest,
    accessToken: string,
    upstreamProxyUrl?: string,
    extraHeaders?: Record<string, string>,
    configSnapshot?: Readonly<ProxyConfig> | null,
  ) => Promise<GeminiResponse>;
  streamGenerateInternal: (
    body: GeminiInternalRequest,
    accessToken: string,
    upstreamProxyUrl?: string,
    extraHeaders?: Record<string, string>,
    configSnapshot?: Readonly<ProxyConfig> | null,
  ) => Promise<NodeJS.ReadableStream>;
}

interface ProxyGenerationLogger {
  warn: (message: string) => void;
}

export function hasUsableGeminiCandidate(response: GeminiResponse): boolean {
  const candidates = response?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return false;
  }

  const first = candidates[0];
  const parts = first?.content?.parts;
  return Array.isArray(parts) && parts.length > 0;
}

export function collectGeminiStreamAsResponse(
  upstreamStream: NodeJS.ReadableStream,
): Promise<GeminiResponse> {
  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder();
    let buffer = '';
    let receivedData = false;
    const mergedParts: InternalGeminiPart[] = [];
    let finishReason: string | undefined;
    let usageMetadata: GeminiResponse['usageMetadata'];

    upstreamStream.on('data', (chunk: Buffer) => {
      receivedData = true;
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) {
          continue;
        }

        const dataStr = trimmed.slice(6);
        if (dataStr === '[DONE]') {
          continue;
        }

        try {
          const parsed = JSON.parse(dataStr);
          const candidate = parsed?.candidates?.[0];
          const parts = candidate?.content?.parts;
          if (Array.isArray(parts)) {
            mergedParts.push(
              ...parts.filter((part): part is InternalGeminiPart => isGeminiPart(part)),
            );
          }

          if (candidate?.finishReason) {
            finishReason = candidate.finishReason;
          }
          if (parsed?.usageMetadata) {
            usageMetadata = parsed.usageMetadata;
          }
        } catch {
          // Ignore malformed chunks and continue collecting valid parts.
        }
      }
    });

    upstreamStream.on('end', () => {
      if (!receivedData) {
        reject(new Error('Empty response stream'));
        return;
      }

      resolve({
        candidates: [
          {
            content: {
              role: 'model',
              parts: mergedParts,
            },
            finishReason,
          },
        ],
        usageMetadata,
      });
    });

    upstreamStream.on('error', (error: unknown) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

export async function generateInternalWithStreamFallback({
  geminiClient,
  body,
  accessToken,
  upstreamProxyUrl,
  extraHeaders,
  configSnapshot,
  logger,
}: {
  geminiClient: GeminiInternalTransport;
  body: GeminiInternalRequest;
  accessToken: string;
  upstreamProxyUrl?: string;
  extraHeaders?: Record<string, string>;
  configSnapshot?: Readonly<ProxyConfig> | null;
  logger: ProxyGenerationLogger;
}): Promise<GeminiResponse> {
  const direct = await geminiClient.generateInternal(
    body,
    accessToken,
    upstreamProxyUrl,
    extraHeaders,
    configSnapshot,
  );
  if (hasUsableGeminiCandidate(direct)) {
    return direct;
  }

  logger.warn('Empty non-stream response detected, falling back to stream aggregation.');
  const stream = await geminiClient.streamGenerateInternal(
    body,
    accessToken,
    upstreamProxyUrl,
    extraHeaders,
    configSnapshot,
  );
  return collectGeminiStreamAsResponse(stream);
}
