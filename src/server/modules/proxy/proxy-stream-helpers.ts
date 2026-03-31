import { StreamingState, PartProcessor } from '../../../lib/antigravity/ClaudeStreamingMapper';
import {
  classifyStreamError,
  formatErrorForSSE,
} from '../../../lib/antigravity/stream-error-utils';
import type { OpenAIChatResponse } from './interfaces/request-interfaces';
import { mapGeminiFinishReasonToOpenAIFinishReason } from './proxy-message-mappers';
import { isGeminiPart } from './proxy-routing-helpers';
import { Observable } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';

interface ProxyStreamLogger {
  error: (message: string, error?: unknown) => void;
}

export function processAnthropicInternalStream(
  upstreamStream: NodeJS.ReadableStream,
  logger: ProxyStreamLogger,
): Observable<string> {
  return new Observable<string>((subscriber) => {
    const decoder = new TextDecoder();
    let buffer = '';

    const state = new StreamingState();
    const processor = new PartProcessor(state);

    let lastFinishReason: string | undefined;
    let lastUsageMetadata: Record<string, unknown> | undefined;

    let receivedData = false;

    upstreamStream.on('data', (chunk: Buffer) => {
      receivedData = true;
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const dataStr = trimmed.slice(6);
        if (dataStr === '[DONE]') continue;

        try {
          const json = JSON.parse(dataStr);

          if (json) {
            const startMsg = state.emitMessageStart(json);
            if (startMsg) subscriber.next(startMsg);
          }

          const candidate = json.candidates?.[0];
          const part = candidate?.content?.parts?.[0];

          if (candidate?.finishReason) {
            lastFinishReason = candidate.finishReason;
          }
          if (json.usageMetadata) {
            lastUsageMetadata = json.usageMetadata;
          }

          if (isGeminiPart(part)) {
            const chunks = processor.process(part);
            chunks.forEach((chunkValue) => subscriber.next(chunkValue));
          }

          state.resetErrorState();
        } catch (error) {
          logger.error('Stream parse error', error);
          const errorChunks = state.handleParseError(dataStr);
          errorChunks.forEach((chunkValue) => subscriber.next(chunkValue));
        }
      }
    });

    upstreamStream.on('end', () => {
      if (!receivedData) {
        subscriber.error(new Error('Empty response stream'));
        return;
      }

      const finishChunks = state.emitFinish(lastFinishReason, lastUsageMetadata);
      finishChunks.forEach((chunkValue) => subscriber.next(chunkValue));
      subscriber.complete();
    });

    upstreamStream.on('error', (error: unknown) => {
      const cleanError = error instanceof Error ? error : new Error(String(error));
      const { type, message } = classifyStreamError(cleanError);

      logger.error(`Stream error: ${type} - ${cleanError.message}`);
      subscriber.next(formatErrorForSSE(type, message));
      subscriber.error(cleanError);
    });
  });
}

export function passthroughSseStream(upstreamStream: NodeJS.ReadableStream): Observable<string> {
  return new Observable<string>((subscriber) => {
    const decoder = new TextDecoder();
    let receivedData = false;

    upstreamStream.on('data', (chunk: Buffer) => {
      receivedData = true;
      subscriber.next(decoder.decode(chunk, { stream: true }));
    });

    upstreamStream.on('end', () => {
      if (!receivedData) {
        subscriber.error(new Error('Empty response stream'));
        return;
      }
      subscriber.complete();
    });

    upstreamStream.on('error', (error: unknown) => {
      const cleanError =
        error instanceof Error ? new Error(error.message) : new Error(String(error));
      subscriber.error(cleanError);
    });
  });
}

export function processOpenAICompatibleStream(
  upstreamStream: NodeJS.ReadableStream,
  model: string,
): Observable<string> {
  return new Observable<string>((subscriber) => {
    const decoder = new TextDecoder();
    let buffer = '';
    let hasEmittedChunk = false;
    let hasSentDone = false;

    const streamId = `chatcmpl-${uuidv4()}`;
    const created = Math.floor(Date.now() / 1000);

    const pushChunk = (payload: Record<string, unknown>): void => {
      hasEmittedChunk = true;
      subscriber.next(`data: ${JSON.stringify(payload)}\n\n`);
    };

    upstreamStream.on('data', (chunk: Buffer) => {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;

        const dataStr = trimmed.slice(6);
        if (dataStr === '[DONE]') continue;

        try {
          const json = JSON.parse(dataStr);
          const candidate = json.candidates?.[0];
          const parts = candidate?.content?.parts || [];

          for (const part of parts) {
            if (part.thought && part.text) {
              pushChunk({
                id: streamId,
                object: 'chat.completion.chunk',
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: { reasoning_content: part.text },
                    finish_reason: null,
                  },
                ],
              });
              continue;
            }

            if (part.functionCall) {
              pushChunk({
                id: streamId,
                object: 'chat.completion.chunk',
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: part.functionCall.id || `${part.functionCall.name}-${uuidv4()}`,
                          type: 'function',
                          function: {
                            name: part.functionCall.name,
                            arguments: JSON.stringify(part.functionCall.args || {}),
                          },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              });
              continue;
            }

            if (part.inlineData) {
              const mimeType = part.inlineData.mimeType || 'image/jpeg';
              const data = part.inlineData.data || '';
              pushChunk({
                id: streamId,
                object: 'chat.completion.chunk',
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: {
                      content: `\n\n![Generated Image](data:${mimeType};base64,${data})\n\n`,
                    },
                    finish_reason: null,
                  },
                ],
              });
              continue;
            }

            if (part.text) {
              pushChunk({
                id: streamId,
                object: 'chat.completion.chunk',
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: { content: part.text },
                    finish_reason: null,
                  },
                ],
              });
            }
          }

          if (candidate?.finishReason) {
            pushChunk({
              id: streamId,
              object: 'chat.completion.chunk',
              created,
              model,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: mapGeminiFinishReasonToOpenAIFinishReason(candidate.finishReason),
                },
              ],
            });
            subscriber.next('data: [DONE]\n\n');
            hasSentDone = true;
            subscriber.complete();
          }
        } catch {
          // Ignore malformed SSE chunks; valid chunks still close the stream properly.
        }
      }
    });

    upstreamStream.on('end', () => {
      if (!hasEmittedChunk) {
        pushChunk({
          id: streamId,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [
            {
              index: 0,
              delta: { content: '' },
              finish_reason: null,
            },
          ],
        });
      }
      if (!hasSentDone) {
        subscriber.next('data: [DONE]\n\n');
      }
      subscriber.complete();
    });

    upstreamStream.on('error', (error: unknown) => {
      const cleanError =
        error instanceof Error ? new Error(error.message) : new Error(String(error));
      subscriber.error(cleanError);
    });
  });
}

export function createSyntheticOpenAIStream(response: OpenAIChatResponse): Observable<string> {
  return new Observable<string>((subscriber) => {
    const streamId = response.id || `chatcmpl-${uuidv4()}`;
    const created = response.created || Math.floor(Date.now() / 1000);
    const model = response.model;
    const choice = response.choices?.[0];
    const finishReason = choice?.finish_reason ?? 'stop';
    const content =
      choice?.message && typeof choice.message.content === 'string' ? choice.message.content : '';
    const chunkSize = 80;

    if (content.length === 0) {
      subscriber.next(
        `data: ${JSON.stringify({
          id: streamId,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: finishReason,
            },
          ],
          usage: response.usage,
        })}\n\n`,
      );
      subscriber.next('data: [DONE]\n\n');
      subscriber.complete();
      return;
    }

    for (let index = 0; index < content.length; index += chunkSize) {
      const piece = content.slice(index, index + chunkSize);
      const isLast = index + chunkSize >= content.length;
      subscriber.next(
        `data: ${JSON.stringify({
          id: streamId,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [
            {
              index: 0,
              delta: { content: piece },
              finish_reason: isLast ? finishReason : null,
            },
          ],
          usage: isLast
            ? response.usage
            : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        })}\n\n`,
      );
    }

    subscriber.next('data: [DONE]\n\n');
    subscriber.complete();
  });
}
