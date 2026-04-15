/** Lightweight LLM client — fetch-based, supports OpenAI and Anthropic APIs. */

import type { Config } from './config.js';

/** Provider -> default base URL mapping. */
const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  ollama: 'http://localhost:11434/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
};

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-5.4',
  anthropic: 'claude-sonnet-4-6-20250514',
  ollama: 'llama3',
  zhipu: 'glm-5',
};

export class LLMClient {
  constructor(
    public provider: string,
    public model: string,
    public apiKey: string,
    public baseUrl: string,
  ) {}

  /** Send a chat completion request and return the assistant message text.
   * Pass opts.model to override the default model for this call. */
  async complete(prompt: string, opts?: { system?: string; model?: string }): Promise<string> {
    if (this.provider === 'anthropic') {
      return this._completeAnthropic(prompt, opts);
    }
    return this._completeOpenAI(prompt, opts);
  }

  /**
   * Call complete() with optional JSON schema constraint and parse response.
   *
   * When schema is provided, uses provider-native constrained decoding:
   * - OpenAI: response_format with json_schema
   * - Anthropic: output_config.format with json_schema
   *
   * Pass opts.model to override the default model for this call (e.g. use a faster model for classification).
   */
  async extractJson<T = unknown>(
    prompt: string,
    opts?: { system?: string; schema?: object; model?: string },
  ): Promise<T | null> {
    if (opts?.schema && this.provider === 'anthropic') {
      const extra = {
        output_config: {
          format: { type: 'json_schema', schema: opts.schema },
        },
      };
      const text = await this._completeAnthropic(prompt, opts, extra);
      return parseJsonResponse(text) as T | null;
    } else if (opts?.schema) {
      // Detect providers that don't support json_schema strict mode
      const isGemini = this.baseUrl.includes('generativelanguage.googleapis.com') ||
                       this.baseUrl.includes('aiplatform.googleapis.com') ||
                       (opts.model ?? this.model).startsWith('gemini');
      const isZhipu = this.baseUrl.includes('bigmodel.cn') ||
                      this.provider === 'zhipu' ||
                      (opts.model ?? this.model).startsWith('glm');
      let extra: Record<string, unknown>;
      if (isZhipu) {
        // Zhipu only supports json_object, not json_schema.
        // Append schema to USER message (not system) to avoid burying behavioral rules.
        const schemaHint = `\n\nRespond with valid JSON matching this schema:\n${JSON.stringify(opts.schema, null, 2)}`;
        prompt += schemaHint;
        extra = {
          response_format: { type: 'json_object' },
        };
      } else if (isGemini) {
        const cleanSchema = stripStrictProps(opts.schema);
        extra = {
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'response', schema: cleanSchema },
          },
        };
      } else {
        extra = {
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'response', strict: true, schema: opts.schema },
          },
        };
      }
      const text = await this._completeOpenAI(prompt, opts, extra);
      return parseJsonResponse(text) as T | null;
    } else {
      const text = await this.complete(prompt, opts);
      return parseJsonResponse(text) as T | null;
    }
  }

  /** OpenAI /chat/completions format. */
  private async _completeOpenAI(
    prompt: string,
    opts?: { system?: string; model?: string },
    extraPayload?: Record<string, unknown>,
  ): Promise<string> {
    const messages: Array<{ role: string; content: string }> = [];
    if (opts?.system) {
      messages.push({ role: 'system', content: opts.system });
    }
    messages.push({ role: 'user', content: prompt });

    const base = this.baseUrl.replace(/\/+$/, '');
    const url = `${base}/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const payload: Record<string, unknown> = {
      model: opts?.model ?? this.model,
      messages,
      temperature: 0.3,
      ...extraPayload,
    };

    const resp = await this._fetchWithRetry(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const data = (await resp.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    return data.choices[0].message.content;
  }

  /** Anthropic /v1/messages format (native API). */
  private async _completeAnthropic(
    prompt: string,
    opts?: { system?: string; model?: string },
    extraPayload?: Record<string, unknown>,
  ): Promise<string> {
    const messages = [{ role: 'user', content: prompt }];

    const url = `${this.baseUrl}/messages`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
    };

    const payload: Record<string, unknown> = {
      model: opts?.model ?? this.model,
      messages,
      max_tokens: 4096,
      temperature: 0.3,
    };
    if (opts?.system) {
      payload.system = opts.system;
    }
    if (extraPayload) {
      Object.assign(payload, extraPayload);
    }

    const resp = await this._fetchWithRetry(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const data = (await resp.json()) as {
      content: Array<{ text: string }>;
    };

    return data.content[0].text;
  }

  /** Fetch with retry on 429/5xx, exponential backoff. */
  private async _fetchWithRetry(
    url: string,
    init: RequestInit,
    maxRetries = 3,
  ): Promise<Response> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const resp = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(180_000),
      });

      if (resp.ok) return resp;

      // Retry on 429 (rate limit) or 5xx (server error)
      if ((resp.status === 429 || resp.status >= 500) && attempt < maxRetries) {
        const retryAfter = resp.headers.get('retry-after');
        const waitMs = retryAfter
          ? Math.min(parseInt(retryAfter, 10) * 1000, 30_000)
          : Math.min(2000 * Math.pow(2, attempt), 30_000);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      const errorBody = await resp.text().catch(() => '');
      throw new Error(`LLM HTTP ${resp.status}: ${resp.statusText} — ${errorBody.slice(0, 500)}`);
    }

    throw new Error('LLM request failed after retries');
  }
}

/** Best-effort JSON extraction from LLM response text. */
export function parseJsonResponse(text: string): unknown | null {
  const trimmed = text.trim();

  // Try direct parse
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  // Try extracting from markdown code block
  const blockMatch = trimmed.match(/```(?:json)?\s*\n?(.*?)```/s);
  if (blockMatch) {
    try {
      return JSON.parse(blockMatch[1].trim());
    } catch {
      // continue
    }
  }

  // Try finding first { ... } block
  const objMatch = trimmed.match(/\{.*\}/s);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch {
      // continue
    }
  }

  return null;
}

/** Create an LLMClient from explicit args, returning null if no provider. */
export function createLlmClient(opts: {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}): LLMClient | null {
  if (!opts.provider) return null;
  // Ollama doesn't need an API key
  if (opts.provider !== 'ollama' && !opts.apiKey) return null;

  return new LLMClient(
    opts.provider,
    opts.model ?? DEFAULT_MODELS[opts.provider] ?? 'gpt-4o-mini',
    opts.apiKey ?? '',
    (opts.baseUrl ?? DEFAULT_BASE_URLS[opts.provider] ?? '').replace(/\/+$/, ''),
  );
}

/** Create an LLMClient from a Config object. */
export function createLlmFromConfig(config: Config): LLMClient | null {
  return createLlmClient({
    provider: config.llmProvider,
    model: config.llmModel,
    apiKey: config.llmApiKey,
    baseUrl: config.llmBaseUrl,
  });
}

/** Remove `strict`, `additionalProperties` from JSON schema (deep).
 *  Gemini's OpenAI-compatible layer rejects these fields. */
function stripStrictProps(schema: object): object {
  const json = JSON.stringify(schema);
  const cleaned = JSON.parse(json, (key, value) => {
    if (key === 'additionalProperties') return undefined;
    if (key === 'strict') return undefined;
    return value;
  });
  return cleaned;
}
