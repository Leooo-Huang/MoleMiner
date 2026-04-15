import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { GitHubSource } from '../../src/sources/github.js';
import { Config } from '../../src/config.js';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('GitHubSource', () => {
  it('has correct metadata', () => {
    const source = new GitHubSource();
    expect(source.name).toBe('github');
    expect(source.sourceType).toBe('api');
    expect(source.requiresAuth).toBe(false);
  });

  it('should search with auth token when configured', async () => {
    let receivedAuth = '';
    server.use(
      http.get('https://api.github.com/search/repositories', ({ request }) => {
        receivedAuth = request.headers.get('authorization') ?? '';
        return HttpResponse.json({
          items: [
            {
              full_name: 'denoland/deno',
              html_url: 'https://github.com/denoland/deno',
              description: 'A modern runtime for JavaScript and TypeScript',
              language: 'Rust',
              stargazers_count: 90000,
              topics: ['javascript', 'typescript', 'runtime'],
              homepage: 'https://deno.land',
            },
          ],
        });
      }),
    );

    const source = new GitHubSource();
    const config = new Config();
    config.githubToken = 'ghp_testtoken123';
    source.configure(config);

    const results = await source.search(['deno']);
    expect(receivedAuth).toBe('Bearer ghp_testtoken123');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('denoland/deno');
    expect(results[0].url).toBe('https://github.com/denoland/deno');
    expect(results[0].source).toBe('github');
    expect(results[0].language).toBe('Rust');
    expect(results[0].metadata?.stars).toBe(90000);
    expect(results[0].metadata?.topics).toEqual(['javascript', 'typescript', 'runtime']);
  });

  it('should search without auth token', async () => {
    let receivedAuth: string | null = null;
    server.use(
      http.get('https://api.github.com/search/repositories', ({ request }) => {
        receivedAuth = request.headers.get('authorization');
        const url = new URL(request.url);
        expect(url.searchParams.get('sort')).toBe('stars');
        expect(url.searchParams.get('per_page')).toBe('20');

        return HttpResponse.json({
          items: [
            {
              full_name: 'some/repo',
              html_url: 'https://github.com/some/repo',
              description: 'A test repo',
              language: 'TypeScript',
              stargazers_count: 100,
              topics: [],
              homepage: null,
            },
          ],
        });
      }),
    );

    const source = new GitHubSource();
    const results = await source.search(['test repo']);
    expect(receivedAuth).toBeNull();
    expect(results).toHaveLength(1);
  });

  it('should classify as direct when homepage exists, lead otherwise', async () => {
    server.use(
      http.get('https://api.github.com/search/repositories', () => {
        return HttpResponse.json({
          items: [
            {
              full_name: 'with/homepage',
              html_url: 'https://github.com/with/homepage',
              description: 'Has homepage',
              language: 'Go',
              stargazers_count: 500,
              topics: [],
              homepage: 'https://withhomepage.dev',
            },
            {
              full_name: 'no/homepage',
              html_url: 'https://github.com/no/homepage',
              description: 'No homepage',
              language: 'Python',
              stargazers_count: 200,
              topics: [],
              homepage: '',
            },
            {
              full_name: 'null/homepage',
              html_url: 'https://github.com/null/homepage',
              description: 'Null homepage',
              language: 'Rust',
              stargazers_count: 50,
              topics: [],
              homepage: null,
            },
          ],
        });
      }),
    );

    const source = new GitHubSource();
    const results = await source.search(['test']);
    expect(results).toHaveLength(3);
    expect(results[0].resultType).toBe('direct');
    expect(results[1].resultType).toBe('lead');
    expect(results[2].resultType).toBe('lead');
  });
});
