import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { fetchWithDefaults, fetchJson, fetchText } from '../../src/utils/http.js';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('fetchWithDefaults', () => {
  it('should send default User-Agent header', async () => {
    let receivedHeaders: Record<string, string> = {};
    server.use(
      http.get('https://test.example.com/ua', ({ request }) => {
        receivedHeaders = Object.fromEntries(request.headers.entries());
        return HttpResponse.json({ ok: true });
      }),
    );

    await fetchWithDefaults('https://test.example.com/ua');
    expect(receivedHeaders['user-agent']).toContain('MoleMiner');
  });

  it('should allow overriding headers', async () => {
    let receivedHeaders: Record<string, string> = {};
    server.use(
      http.get('https://test.example.com/custom', ({ request }) => {
        receivedHeaders = Object.fromEntries(request.headers.entries());
        return HttpResponse.json({ ok: true });
      }),
    );

    await fetchWithDefaults('https://test.example.com/custom', {
      headers: { 'X-Custom': 'test-value' },
    });
    expect(receivedHeaders['x-custom']).toBe('test-value');
    // Default UA should still be there
    expect(receivedHeaders['user-agent']).toContain('MoleMiner');
  });
});

describe('fetchJson', () => {
  it('should parse JSON response', async () => {
    server.use(
      http.get('https://test.example.com/json', () => {
        return HttpResponse.json({ name: 'test', value: 42 });
      }),
    );

    const data = await fetchJson<{ name: string; value: number }>(
      'https://test.example.com/json',
    );
    expect(data.name).toBe('test');
    expect(data.value).toBe(42);
  });

  it('should throw on non-ok status', async () => {
    server.use(
      http.get('https://test.example.com/error', () => {
        return new HttpResponse('Not Found', { status: 404, statusText: 'Not Found' });
      }),
    );

    await expect(fetchJson('https://test.example.com/error')).rejects.toThrow('HTTP 404');
  });

  it('should throw on server error', async () => {
    server.use(
      http.get('https://test.example.com/500', () => {
        return new HttpResponse('Internal Server Error', {
          status: 500,
          statusText: 'Internal Server Error',
        });
      }),
    );

    await expect(fetchJson('https://test.example.com/500')).rejects.toThrow('HTTP 500');
  });
});

describe('fetchText', () => {
  it('should return text response', async () => {
    server.use(
      http.get('https://test.example.com/text', () => {
        return new HttpResponse('Hello, World!', {
          headers: { 'Content-Type': 'text/plain' },
        });
      }),
    );

    const text = await fetchText('https://test.example.com/text');
    expect(text).toBe('Hello, World!');
  });

  it('should throw on non-ok status', async () => {
    server.use(
      http.get('https://test.example.com/text-error', () => {
        return new HttpResponse('Forbidden', { status: 403, statusText: 'Forbidden' });
      }),
    );

    await expect(fetchText('https://test.example.com/text-error')).rejects.toThrow('HTTP 403');
  });
});

describe('timeout', () => {
  it('should abort on timeout', async () => {
    server.use(
      http.get('https://test.example.com/slow', async () => {
        // Delay longer than our timeout
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return HttpResponse.json({ ok: true });
      }),
    );

    await expect(
      fetchWithDefaults('https://test.example.com/slow', { timeout: 100 }),
    ).rejects.toThrow();
  });
});
