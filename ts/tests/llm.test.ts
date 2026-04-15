import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  LLMClient,
  createLlmClient,
  createLlmFromConfig,
  parseJsonResponse,
} from '../src/llm.js';
import { Config } from '../src/config.js';

// --- parseJsonResponse tests (no HTTP needed) ---

describe('parseJsonResponse', () => {
  it('should parse direct JSON', () => {
    const result = parseJsonResponse('{"key": "value"}');
    expect(result).toEqual({ key: 'value' });
  });

  it('should parse JSON from markdown code block', () => {
    const text = 'Here is the response:\n```json\n{"key": "value"}\n```\nDone.';
    const result = parseJsonResponse(text);
    expect(result).toEqual({ key: 'value' });
  });

  it('should parse embedded JSON object', () => {
    const text = 'The result is {"key": "value"} as expected.';
    const result = parseJsonResponse(text);
    expect(result).toEqual({ key: 'value' });
  });

  it('should return null for invalid input', () => {
    expect(parseJsonResponse('no json here')).toBeNull();
  });

  it('should handle JSON with whitespace', () => {
    const result = parseJsonResponse('  \n  {"key": "value"}  \n  ');
    expect(result).toEqual({ key: 'value' });
  });

  it('should parse array JSON', () => {
    const result = parseJsonResponse('[1, 2, 3]');
    expect(result).toEqual([1, 2, 3]);
  });
});

// --- createLlmClient / createLlmFromConfig tests ---

describe('createLlmClient', () => {
  it('should use default values for provider', () => {
    const client = createLlmClient({ provider: 'openai', apiKey: 'sk-test' });
    expect(client).not.toBeNull();
    expect(client!.provider).toBe('openai');
    expect(client!.model).toBe('gpt-5.4');
    expect(client!.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('should use custom values', () => {
    const client = createLlmClient({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'sk-custom',
      baseUrl: 'https://custom.api.com/v1',
    });
    expect(client).not.toBeNull();
    expect(client!.model).toBe('gpt-4o');
    expect(client!.baseUrl).toBe('https://custom.api.com/v1');
  });

  it('should return null if no provider', () => {
    expect(createLlmClient({ apiKey: 'sk-test' })).toBeNull();
  });

  it('should return null if no api key for non-ollama', () => {
    expect(createLlmClient({ provider: 'openai' })).toBeNull();
  });

  it('should allow ollama without api key', () => {
    const client = createLlmClient({ provider: 'ollama' });
    expect(client).not.toBeNull();
    expect(client!.provider).toBe('ollama');
  });

  it('should default anthropic model', () => {
    const client = createLlmClient({ provider: 'anthropic', apiKey: 'sk-ant-test' });
    expect(client!.model).toBe('claude-sonnet-4-6-20250514');
  });
});

describe('createLlmFromConfig', () => {
  it('should create client from config', () => {
    const cfg = new Config();
    cfg.llmProvider = 'openai';
    cfg.llmApiKey = 'sk-test';
    cfg.llmModel = 'gpt-4o';
    const client = createLlmFromConfig(cfg);
    expect(client).not.toBeNull();
    expect(client!.model).toBe('gpt-4o');
  });

  it('should return null when no provider in config', () => {
    const cfg = new Config();
    cfg.llmApiKey = 'sk-test';
    expect(createLlmFromConfig(cfg)).toBeNull();
  });

  it('should return null when no api key in config', () => {
    const cfg = new Config();
    cfg.llmProvider = 'openai';
    expect(createLlmFromConfig(cfg)).toBeNull();
  });
});

// --- HTTP tests using msw ---

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('LLMClient OpenAI', () => {
  it('should send correct request format for complete()', async () => {
    let capturedBody: Record<string, unknown> = {};
    let capturedHeaders: Record<string, string> = {};

    server.use(
      http.post('https://api.openai.com/v1/chat/completions', async ({ request }) => {
        capturedHeaders = Object.fromEntries(request.headers.entries());
        capturedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({
          choices: [{ message: { content: 'Hello from GPT' } }],
        });
      }),
    );

    const client = new LLMClient('openai', 'gpt-5.4', 'sk-test123', 'https://api.openai.com/v1');
    const result = await client.complete('Say hello', { system: 'You are helpful' });

    expect(result).toBe('Hello from GPT');
    expect(capturedHeaders['authorization']).toBe('Bearer sk-test123');
    expect(capturedBody.model).toBe('gpt-5.4');
    const messages = capturedBody.messages as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toBe('You are helpful');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toBe('Say hello');
  });

  it('should send extractJson with response_format for schema', async () => {
    let capturedBody: Record<string, unknown> = {};

    server.use(
      http.post('https://api.openai.com/v1/chat/completions', async ({ request }) => {
        capturedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({
          choices: [{ message: { content: '{"key": "value"}' } }],
        });
      }),
    );

    const client = new LLMClient('openai', 'gpt-5.4', 'sk-test', 'https://api.openai.com/v1');
    const schema = { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] };
    const result = await client.extractJson('Extract', { schema });

    expect(result).toEqual({ key: 'value' });
    const rf = capturedBody.response_format as Record<string, unknown>;
    expect(rf.type).toBe('json_schema');
    const js = rf.json_schema as Record<string, unknown>;
    expect(js.name).toBe('response');
    expect(js.strict).toBe(true);
    expect(js.schema).toEqual(schema);
  });

  it('should handle complete without system prompt', async () => {
    let capturedBody: Record<string, unknown> = {};

    server.use(
      http.post('https://api.openai.com/v1/chat/completions', async ({ request }) => {
        capturedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({
          choices: [{ message: { content: 'response' } }],
        });
      }),
    );

    const client = new LLMClient('openai', 'gpt-5.4', 'sk-test', 'https://api.openai.com/v1');
    await client.complete('Just a prompt');

    const messages = capturedBody.messages as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
  });
});

describe('LLMClient Anthropic', () => {
  it('should send correct headers and request format', async () => {
    let capturedBody: Record<string, unknown> = {};
    let capturedHeaders: Record<string, string> = {};

    server.use(
      http.post('https://api.anthropic.com/v1/messages', async ({ request }) => {
        capturedHeaders = Object.fromEntries(request.headers.entries());
        capturedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({
          content: [{ text: 'Hello from Claude' }],
        });
      }),
    );

    const client = new LLMClient('anthropic', 'claude-sonnet-4-6-20250514', 'sk-ant-key', 'https://api.anthropic.com/v1');
    const result = await client.complete('Say hello', { system: 'You are helpful' });

    expect(result).toBe('Hello from Claude');
    expect(capturedHeaders['x-api-key']).toBe('sk-ant-key');
    expect(capturedHeaders['anthropic-version']).toBe('2023-06-01');
    // System is a top-level param, NOT in messages
    expect(capturedBody.system).toBe('You are helpful');
    const messages = capturedBody.messages as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
  });

  it('should send extractJson with output_config for schema', async () => {
    let capturedBody: Record<string, unknown> = {};

    server.use(
      http.post('https://api.anthropic.com/v1/messages', async ({ request }) => {
        capturedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({
          content: [{ text: '{"key": "value"}' }],
        });
      }),
    );

    const client = new LLMClient('anthropic', 'claude-sonnet-4-6-20250514', 'sk-ant-key', 'https://api.anthropic.com/v1');
    const schema = { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] };
    const result = await client.extractJson('Extract', { schema });

    expect(result).toEqual({ key: 'value' });
    const oc = capturedBody.output_config as Record<string, unknown>;
    const fmt = oc.format as Record<string, unknown>;
    expect(fmt.type).toBe('json_schema');
    expect(fmt.schema).toEqual(schema);
  });

  it('should not include system in body when not provided', async () => {
    let capturedBody: Record<string, unknown> = {};

    server.use(
      http.post('https://api.anthropic.com/v1/messages', async ({ request }) => {
        capturedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({
          content: [{ text: 'response' }],
        });
      }),
    );

    const client = new LLMClient('anthropic', 'claude-sonnet-4-6-20250514', 'sk-ant-key', 'https://api.anthropic.com/v1');
    await client.complete('Just a prompt');

    expect(capturedBody).not.toHaveProperty('system');
  });
});

describe('LLMClient extractJson without schema', () => {
  it('should fall back to parseJsonResponse', async () => {
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', async () => {
        return HttpResponse.json({
          choices: [{ message: { content: '```json\n{"result": 42}\n```' } }],
        });
      }),
    );

    const client = new LLMClient('openai', 'gpt-5.4', 'sk-test', 'https://api.openai.com/v1');
    const result = await client.extractJson('Give me JSON');

    expect(result).toEqual({ result: 42 });
  });
});
