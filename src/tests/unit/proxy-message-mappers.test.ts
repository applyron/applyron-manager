import { describe, expect, it } from 'vitest';
import {
  convertClaudeToOpenAIResponse,
  convertOpenAIToClaude,
} from '@/server/modules/proxy/proxy-message-mappers';

describe('proxy message mappers', () => {
  it('converts OpenAI chat input into Claude format with system and tool messages', () => {
    const request = {
      model: 'claude-sonnet',
      stream: false,
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'I can help' }],
          tool_calls: [
            {
              id: 'tool-1',
              function: {
                name: 'lookup',
                arguments: '{"term":"applyron"}',
              },
            },
          ],
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup',
            description: 'Lookup something',
            parameters: {
              type: 'object',
              properties: {
                term: { type: 'string' },
              },
            },
          },
        },
      ],
      extra: {
        session_id: 'sess-1',
      },
    } as const;

    const result = convertOpenAIToClaude(request as never);

    expect(result.system).toBe('System prompt');
    expect(result.messages[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Hello' }],
    });
    expect(result.messages[1]).toMatchObject({
      role: 'assistant',
    });
    expect(result.tools?.[0]).toMatchObject({
      name: 'lookup',
    });
    expect(result.metadata).toMatchObject({
      source: 'openai',
      session_id: 'sess-1',
    });
  });

  it('converts Claude output into OpenAI-compatible response shape', () => {
    const result = convertClaudeToOpenAIResponse(
      {
        id: 'claude-response',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet',
        stop_reason: 'tool_use',
        stop_sequence: null,
        content: [
          { type: 'text', text: 'Answer' },
          { type: 'tool_use', id: 'tool-1', name: 'lookup', input: { term: 'applyron' } },
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      } as never,
      'gpt-4.1',
    );

    expect(result.id.startsWith('chatcmpl-')).toBe(true);
    expect(result.model).toBe('gpt-4.1');
    expect(result.choices[0]?.message.content).toBe('Answer');
    expect(result.choices[0]?.message.tool_calls?.[0]).toMatchObject({
      id: 'tool-1',
      function: {
        name: 'lookup',
      },
    });
    expect(result.choices[0]?.finish_reason).toBe('tool_calls');
    expect(result.usage.total_tokens).toBe(15);
  });
});
