import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { BraveSource } from '../../src/sources/brave.js';
import { Config } from '../../src/config.js';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('BraveSource', () => {
  it('has correct metadata', () => {
    const source = new BraveSource();
    expect(source.name).toBe('brave');
    expect(source.sourceType).toBe('api');
    expect(source.requiresAuth).toBe(true);
  });

  it('should be disabled without API key', () => {
    const source = new BraveSource();
    expect(source.enabled(new Config())).toBe(false);
  });

  it('should be enabled with API key', () => {
    const source = new BraveSource();
    const config = new Config();
    config.braveApiKey = 'BSA_test123';
    expect(source.enabled(config)).toBe(true);
  });

  it('should return results for a successful search', async () => {
    let receivedToken = '';
    server.use(
      http.get('https://api.search.brave.com/res/v1/web/search', ({ request }) => {
        receivedToken = request.headers.get('x-subscription-token') ?? '';
        const url = new URL(request.url);
        expect(url.searchParams.get('q')).toBe('machine learning');
        expect(url.searchParams.get('count')).toBe('20');

        return HttpResponse.json({
          web: {
            results: [
              {
                title: 'Introduction to Machine Learning',
                url: 'https://example.com/ml-intro',
                description: 'A comprehensive guide to ML basics',
                page_age: '2026-01-20',
                language: 'en',
              },
              {
                title: 'ML Frameworks Comparison',
                url: 'https://example.com/ml-frameworks',
                description: 'Comparing PyTorch, TensorFlow, and JAX',
                page_age: '2026-02-10',
                language: 'en',
              },
            ],
          },
        });
      }),
    );

    const source = new BraveSource();
    const config = new Config();
    config.braveApiKey = 'BSA_mykey456';
    source.configure(config);

    const results = await source.search(['machine learning']);
    expect(receivedToken).toBe('BSA_mykey456');
    expect(results).toHaveLength(2);

    expect(results[0].title).toBe('Introduction to Machine Learning');
    expect(results[0].url).toBe('https://example.com/ml-intro');
    expect(results[0].source).toBe('brave');
    expect(results[0].resultType).toBe('direct');
    expect(results[0].snippet).toBe('A comprehensive guide to ML basics');
    expect(results[0].timestamp).toBe('2026-01-20');
    expect(results[0].language).toBe('en');
  });

  it('should send auth header with X-Subscription-Token', async () => {
    let receivedToken = '';
    server.use(
      http.get('https://api.search.brave.com/res/v1/web/search', ({ request }) => {
        receivedToken = request.headers.get('x-subscription-token') ?? '';
        return HttpResponse.json({ web: { results: [] } });
      }),
    );

    const source = new BraveSource();
    const config = new Config();
    config.braveApiKey = 'BSA_authtest';
    source.configure(config);

    await source.search(['test']);
    expect(receivedToken).toBe('BSA_authtest');
  });
});
