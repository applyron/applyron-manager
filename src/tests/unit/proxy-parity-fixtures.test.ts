import { readFileSync } from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';
import {
  convertClaudeToOpenAIResponse,
  convertOpenAIToClaude,
} from '../../server/modules/proxy/proxy-message-mappers';
import { processOpenAICompatibleStream } from '../../server/modules/proxy/proxy-stream-helpers';

function readFixture<T>(relativePath: string): T {
  const fullPath = path.join(process.cwd(), 'src/tests/fixtures/proxy-parity', relativePath);
  return JSON.parse(readFileSync(fullPath, 'utf-8')) as T;
}

function asReadableStream(stream: EventEmitter): NodeJS.ReadableStream {
  return stream as unknown as NodeJS.ReadableStream;
}

describe('Proxy Parity Fixtures', () => {
  it('maps OpenAI request fixture to expected Anthropic request semantics', () => {
    const input = readFixture<any>('request/openai.chat-tools.input.json');
    const expected = readFixture<any>('request/openai.chat-tools.expected.json');

    const actual = convertOpenAIToClaude(input);

    expect(actual.model).toBe(expected.model);
    expect(actual.system).toBe(expected.system);
    expect(actual.temperature).toBe(expected.temperature);
    expect(actual.max_tokens).toBe(expected.max_tokens);
    expect(actual.tools?.[0]?.name).toBe(expected.tools[0].name);
    expect(actual.messages[0]).toEqual(expected.messages[0]);
    expect(actual.messages[1].content[1]).toEqual(expected.messages[1].content[1]);
    expect(actual.messages[2].content[0]).toEqual(expected.messages[2].content[0]);
  });

  it('maps Anthropic response fixture to expected OpenAI response semantics', () => {
    const input = readFixture<any>('response/anthropic.tool-use.input.json');
    const expected = readFixture<any>('response/anthropic.tool-use.expected.json');

    const actual = convertClaudeToOpenAIResponse(input, expected.model);

    expect(actual.model).toBe(expected.model);
    expect(actual.choices[0].message.content).toBe(expected.message.content);
    expect(actual.choices[0].message.reasoning_content).toBe(expected.message.reasoning_content);
    expect(actual.choices[0].message.tool_calls?.[0]).toEqual(expected.message.tool_calls[0]);
    expect(actual.choices[0].finish_reason).toBe(expected.finish_reason);
    expect(actual.usage).toEqual(expected.usage);
  });

  it('maps upstream stream fixture into expected OpenAI SSE semantics', async () => {
    const input = readFixture<any>('stream/openai-from-gemini.input.json');
    const expected = readFixture<{ contains: string[] }>('stream/openai-from-gemini.expected.json');

    const stream = new EventEmitter();
    const outputChunks: string[] = [];

    const promise = new Promise<void>((resolve, reject) => {
      processOpenAICompatibleStream(asReadableStream(stream), input.model).subscribe({
        next: (chunk) => outputChunks.push(chunk),
        error: reject,
        complete: resolve,
      });
    });

    stream.emit('data', Buffer.from(`data: ${JSON.stringify(input.upstream)}\n`));
    stream.emit('end');

    await promise;

    const output = outputChunks.join('');
    for (const token of expected.contains) {
      expect(output).toContain(token);
    }
  });
});
