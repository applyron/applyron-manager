import { isEmpty, isNil, isPlainObject, isString } from 'lodash-es';
import { v4 as uuidv4 } from 'uuid';
import { normalizeObjectJsonSchema } from '../../../lib/antigravity/JsonSchemaUtils';
import type {
  ClaudeRequest,
  ClaudeResponse,
  GeminiInternalRequest,
} from '../../../lib/antigravity/types';
import type {
  AnthropicChatRequest,
  AnthropicChatResponse,
  AnthropicContent,
  GeminiRequest,
  GeminiResponse,
  OpenAIChatRequest,
  OpenAIChatResponse,
} from './interfaces/request-interfaces';

function isRecord(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value);
}

export function toClaudeRequest(request: AnthropicChatRequest): ClaudeRequest {
  return {
    model: request.model,
    messages: request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    system: request.system,
    tools: request.tools?.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
      type: tool.type,
    })),
    stream: request.stream,
    max_tokens: request.max_tokens,
    stop_sequences: request.stop_sequences,
    temperature: request.temperature,
    top_p: request.top_p,
    top_k: request.top_k,
    thinking: request.thinking,
    metadata: request.metadata,
  };
}

export function toAnthropicChatResponse(response: ClaudeResponse): AnthropicChatResponse {
  return {
    id: response.id,
    type: response.type,
    role: response.role,
    model: response.model,
    content: response.content,
    stop_reason: response.stop_reason,
    stop_sequence: response.stop_sequence,
    usage: {
      input_tokens: response.usage?.input_tokens ?? 0,
      output_tokens: response.usage?.output_tokens ?? 0,
      cache_creation_input_tokens: response.usage?.cache_creation_input_tokens,
      cache_read_input_tokens: response.usage?.cache_read_input_tokens,
    },
  };
}

export function toInternalGeminiRequest(request: GeminiRequest): GeminiInternalRequest['request'] {
  return {
    contents: request.contents,
    generationConfig: request.generationConfig,
    systemInstruction: request.systemInstruction
      ? {
          parts: request.systemInstruction.parts
            .filter((part): part is { text: string } => typeof part.text === 'string')
            .map((part) => ({ text: part.text })),
        }
      : undefined,
  };
}

export function createGeminiInternalRequest(
  model: string,
  request: GeminiRequest,
  projectId: string | undefined,
  requestType: string,
  requestUserAgent: string,
): GeminiInternalRequest {
  const normalizedProjectId = projectId?.trim();

  const internalRequest: GeminiInternalRequest = {
    requestId: uuidv4(),
    request: toInternalGeminiRequest(request),
    model,
    userAgent: requestUserAgent,
    requestType,
  };

  if (normalizedProjectId) {
    internalRequest.project = normalizedProjectId;
  }

  return internalRequest;
}

export function normalizeGeminiGenerateResponse(response: GeminiResponse): GeminiResponse {
  const candidates = Array.isArray(response.candidates)
    ? response.candidates.map((candidate, index) => ({
        content: candidate?.content,
        finishReason: candidate?.finishReason,
        index: typeof candidate?.index === 'number' ? candidate.index : index,
      }))
    : [];

  const normalized: GeminiResponse = {
    candidates,
  };

  const usage = response.usageMetadata;
  if (usage) {
    const usageMetadata: NonNullable<GeminiResponse['usageMetadata']> = {};
    if (usage.promptTokenCount !== undefined) {
      usageMetadata.promptTokenCount = usage.promptTokenCount;
    }
    if (usage.candidatesTokenCount !== undefined) {
      usageMetadata.candidatesTokenCount = usage.candidatesTokenCount;
    }
    if (usage.totalTokenCount !== undefined) {
      usageMetadata.totalTokenCount = usage.totalTokenCount;
    }
    if (usage.promptTokensDetails !== undefined) {
      usageMetadata.promptTokensDetails = usage.promptTokensDetails;
    }
    if (usage.candidatesTokensDetails !== undefined) {
      usageMetadata.candidatesTokensDetails = usage.candidatesTokensDetails;
    }
    if (usage.trafficType !== undefined) {
      usageMetadata.trafficType = usage.trafficType;
    }
    if (!isEmpty(usageMetadata)) {
      normalized.usageMetadata = usageMetadata;
    }
  }

  return normalized;
}

export function extractOpenAITextContent(
  content: OpenAIChatRequest['messages'][number]['content'],
): string {
  if (typeof content === 'string') {
    return content;
  }

  return content
    .filter((part) => part.type === 'text')
    .map((part) => part.text || '')
    .join('\n');
}

export function convertOpenAIPartsToAnthropicContent(
  content: OpenAIChatRequest['messages'][number]['content'],
): AnthropicContent[] {
  if (typeof content === 'string') {
    return content.trim() ? [{ type: 'text', text: content }] : [];
  }

  const blocks: AnthropicContent[] = [];
  for (const part of content) {
    if (part.type === 'text' && part.text) {
      blocks.push({ type: 'text', text: part.text });
      continue;
    }

    if (part.type === 'image_url' && part.image_url?.url) {
      const url = part.image_url.url;
      const dataUri = url.match(/^data:(?<mime>[^;]+);base64,(?<data>.+)$/);
      if (dataUri?.groups?.mime && dataUri.groups.data) {
        blocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: dataUri.groups.mime,
            data: dataUri.groups.data,
          },
        });
      } else {
        blocks.push({ type: 'text', text: `[image_url] ${url}` });
      }
    }
  }
  return blocks;
}

export function parseOpenAIFunctionArguments(argumentsString: string): Record<string, unknown> {
  if (!argumentsString || argumentsString.trim() === '') {
    return {};
  }

  try {
    const parsed = JSON.parse(argumentsString);
    if (isRecord(parsed)) {
      return parsed;
    }
    return { value: parsed };
  } catch {
    return { raw: argumentsString };
  }
}

export function convertOpenAIToolsToAnthropicTools(
  tools: OpenAIChatRequest['tools'],
): AnthropicChatRequest['tools'] {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  const result: NonNullable<AnthropicChatRequest['tools']> = [];
  const searchToolTypes = new Set([
    'web_search_20250305',
    'google_search',
    'google_search_retrieval',
    'builtin_web_search',
  ]);

  for (const tool of tools) {
    if (!tool) {
      continue;
    }

    const toolType = isString(tool.type) ? tool.type.toLowerCase() : '';
    const functionName = isString(tool.function?.name) ? tool.function.name : '';
    const normalizedFunctionName = functionName.toLowerCase();
    const isSearchTool =
      searchToolTypes.has(toolType) || searchToolTypes.has(normalizedFunctionName);

    if (isSearchTool) {
      result.push({
        name: functionName || 'builtin_web_search',
        type: 'web_search_20250305',
        input_schema: {
          type: 'object',
          properties: {},
        },
      });
      continue;
    }

    if (!tool.function || !functionName) {
      continue;
    }

    const inputSchema = normalizeObjectJsonSchema(tool.function.parameters);

    result.push({
      name: functionName,
      description: tool.function.description,
      input_schema: inputSchema,
    });
  }

  return result.length > 0 ? result : undefined;
}

export function convertOpenAIToClaude(request: OpenAIChatRequest): ClaudeRequest {
  const messages = request.messages || [];
  const systemPromptParts: string[] = [];
  const anthropicMessages: ClaudeRequest['messages'] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      const systemText = extractOpenAITextContent(msg.content);
      if (systemText) {
        systemPromptParts.push(systemText);
      }
      continue;
    }

    if (msg.role === 'tool') {
      const toolResultText = extractOpenAITextContent(msg.content) || '';
      anthropicMessages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: msg.tool_call_id || msg.name || `tool-result-${uuidv4()}`,
            content: toolResultText,
            is_error: false,
          },
        ],
      });
      continue;
    }

    const contentBlocks = convertOpenAIPartsToAnthropicContent(msg.content);

    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      for (const toolCall of msg.tool_calls) {
        contentBlocks.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.function.name,
          input: parseOpenAIFunctionArguments(toolCall.function.arguments),
        });
      }
    }

    anthropicMessages.push({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: contentBlocks.length > 0 ? contentBlocks : '',
    });
  }

  const systemPrompt = systemPromptParts.length > 0 ? systemPromptParts.join('\n') : undefined;

  return {
    model: request.model,
    messages: anthropicMessages,
    system: systemPrompt,
    tools: convertOpenAIToolsToAnthropicTools(request.tools),
    max_tokens: request.max_tokens,
    temperature: request.temperature,
    top_p: request.top_p,
    stream: request.stream,
    metadata: {
      ...(request.extra ?? {}),
      source: 'openai',
    },
  };
}

export function mapGeminiFinishReasonToOpenAIFinishReason(finishReason?: string): string | null {
  if (!finishReason) {
    return null;
  }

  const normalized = finishReason.toUpperCase();
  if (normalized === 'STOP') {
    return 'stop';
  }
  if (normalized === 'MAX_TOKENS') {
    return 'length';
  }
  if (normalized === 'SAFETY' || normalized === 'RECITATION') {
    return 'content_filter';
  }

  return finishReason.toLowerCase();
}

export function mapAnthropicStopReasonToOpenAIFinishReason(
  stopReason?: string | null,
): string | null {
  if (!stopReason) {
    return null;
  }

  if (stopReason === 'end_turn') {
    return 'stop';
  }
  if (stopReason === 'max_tokens') {
    return 'length';
  }
  if (stopReason === 'tool_use') {
    return 'tool_calls';
  }

  return stopReason;
}

export function normalizeToolCallArguments(input: unknown): string {
  if (typeof input === 'string') {
    return input;
  }
  if (isNil(input)) {
    return '{}';
  }

  try {
    return JSON.stringify(input);
  } catch {
    return '{}';
  }
}

export function convertClaudeToOpenAIResponse(
  claudeResponse: ClaudeResponse,
  model: string,
): OpenAIChatResponse {
  const contentBlocks = Array.isArray(claudeResponse?.content) ? claudeResponse.content : [];

  const textContent = contentBlocks
    .filter(
      (
        block,
      ): block is Extract<ClaudeResponse['content'][number], { type: 'text'; text: string }> =>
        block?.type === 'text',
    )
    .map((block) => block.text || '')
    .join('');

  const reasoningContent = contentBlocks
    .filter(
      (
        block,
      ): block is Extract<
        ClaudeResponse['content'][number],
        { type: 'thinking'; thinking: string }
      > => block?.type === 'thinking',
    )
    .map((block) => block.thinking || '')
    .join('\n');

  const toolCalls = contentBlocks
    .filter(
      (
        block,
      ): block is Extract<
        ClaudeResponse['content'][number],
        { type: 'tool_use'; id: string; name: string; input: unknown }
      > => block?.type === 'tool_use',
    )
    .map((block, index: number) => ({
      id: block.id || `tool-call-${index}`,
      type: 'function' as const,
      function: {
        name: block.name || 'unknown_tool',
        arguments: normalizeToolCallArguments(block.input),
      },
    }));

  return {
    id: `chatcmpl-${uuidv4()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: textContent || null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          reasoning_content: reasoningContent || undefined,
        },
        finish_reason: mapAnthropicStopReasonToOpenAIFinishReason(claudeResponse.stop_reason),
      },
    ],
    usage: {
      prompt_tokens: claudeResponse.usage?.input_tokens || 0,
      completion_tokens: claudeResponse.usage?.output_tokens || 0,
      total_tokens:
        (claudeResponse.usage?.input_tokens || 0) + (claudeResponse.usage?.output_tokens || 0),
    },
  };
}
