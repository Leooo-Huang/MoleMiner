/**
 * Content extraction: HTML → clean text.
 *
 * Two-layer pipeline:
 *   Layer 1 (extract): Defuddle (primary) → Readability (fallback) → strips HTML to content
 *   Layer 2 (compress): Rule-based noise removal (see compress.ts)
 *
 * Priority: key information must NEVER be lost > minimize content length.
 */

import { Defuddle } from 'defuddle/node';
import type { DefuddleResponse } from 'defuddle/node';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { compressText } from './compress.js';

/** Metadata extracted alongside the content. */
export interface ExtractedContent {
  /** Clean text content (after extraction + compression). */
  text: string;
  /** Page title. */
  title: string;
  /** Publication date (ISO string or raw string from page). */
  published: string;
  /** Author name. */
  author: string;
  /** Detected language. */
  language: string;
  /** Word/character count of the extracted content (before compression). */
  rawLength: number;
  /** Word/character count after compression. */
  compressedLength: number;
  /** Which extractor produced the result: 'defuddle' | 'readability' | 'fallback'. */
  extractor: 'defuddle' | 'readability' | 'fallback';
}

/** Minimum content length (in characters) to accept Defuddle output. */
const MIN_CONTENT_LENGTH = 200;

/**
 * Extract and compress content from raw HTML.
 *
 * @param html - Raw HTML string
 * @param url  - The page URL (used for resolving relative links and extractor hints)
 * @returns Extracted and compressed content with metadata
 */
export async function extractContent(html: string, url: string): Promise<ExtractedContent> {
  // --- Layer 1: Extract main content ---
  let content = '';
  let title = '';
  let published = '';
  let author = '';
  let language = '';
  let extractor: ExtractedContent['extractor'] = 'defuddle';

  // Try Defuddle first (more forgiving, preserves more content)
  // defuddle/node accepts HTML string directly — no JSDOM needed
  try {
    const defuddled: DefuddleResponse = await Defuddle(html, url, {
      markdown: true,
    });

    if (defuddled.contentMarkdown && defuddled.contentMarkdown.length >= MIN_CONTENT_LENGTH) {
      content = defuddled.contentMarkdown;
      title = defuddled.title ?? '';
      published = defuddled.published ?? '';
      author = defuddled.author ?? '';
      language = defuddled.language ?? '';
      extractor = 'defuddle';
    } else if (defuddled.content && defuddled.content.length >= MIN_CONTENT_LENGTH) {
      // Defuddle returned HTML content but not markdown — strip tags
      content = stripHtmlTags(defuddled.content);
      title = defuddled.title ?? '';
      published = defuddled.published ?? '';
      author = defuddled.author ?? '';
      language = defuddled.language ?? '';
      extractor = 'defuddle';
    }
  } catch {
    // Defuddle failed, will try Readability
  }

  // Fallback: Readability
  if (content.length < MIN_CONTENT_LENGTH) {
    try {
      const doc = new JSDOM(html, { url }).window.document;
      const article = new Readability(doc).parse();
      if (article && article.textContent && article.textContent.length >= MIN_CONTENT_LENGTH) {
        content = article.textContent;
        title = title || article.title || '';
        extractor = 'readability';
      }
    } catch {
      // Readability also failed
    }
  }

  // Last resort: extract all <p> and heading text from body
  if (content.length < MIN_CONTENT_LENGTH) {
    const doc = new JSDOM(html, { url }).window.document;
    content = fallbackExtract(doc);
    extractor = 'fallback';
  }

  // Extract title from <title> tag if still empty
  if (!title) {
    const doc = new JSDOM(html, { url }).window.document;
    title = doc.querySelector('title')?.textContent?.trim() ?? '';
  }

  // Extract date from content if Defuddle didn't find one
  if (!published) {
    published = extractDateFromText(content) ?? '';
  }

  const rawLength = content.length;

  // --- Layer 2: Rule-based compression ---
  const compressed = compressText(content, { language: language || detectLanguage(content) });

  return {
    text: compressed,
    title,
    published,
    author,
    language: language || detectLanguage(content),
    rawLength,
    compressedLength: compressed.length,
    extractor,
  };
}

/**
 * Fallback extractor: grab all <p>, <h1>-<h6>, <li>, <td> text from body.
 * Used when both Defuddle and Readability fail (very short pages, unusual structure).
 */
function fallbackExtract(document: Document): string {
  const selectors = 'p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, pre';
  const elements = document.querySelectorAll(selectors);
  const texts: string[] = [];

  for (const el of elements) {
    const text = el.textContent?.trim();
    if (text && text.length > 0) {
      texts.push(text);
    }
  }

  return texts.join('\n\n');
}

/** Strip HTML tags, collapse whitespace, decode entities. */
function stripHtmlTags(html: string): string {
  const dom = new JSDOM(`<body>${html}</body>`);
  return dom.window.document.body.textContent?.trim() ?? '';
}

/** Simple language detection: CJK content → 'zh', otherwise 'en'. */
function detectLanguage(text: string): string {
  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const totalChars = text.length;
  if (totalChars === 0) return 'en';
  return cjkCount / totalChars > 0.1 ? 'zh' : 'en';
}

/** Extract the first date found in the first 500 chars of text. */
function extractDateFromText(text: string): string | null {
  const head = text.slice(0, 500);
  const patterns = [
    // ISO format: 2025-03-31 or 2025-03-31T...
    /(\d{4}-\d{2}-\d{2})/,
    // Chinese format: 2025年3月31日
    /(\d{4})年(\d{1,2})月(\d{1,2})日/,
    // Slash format: 2025/03/31
    /(\d{4})\/(\d{2})\/(\d{2})/,
  ];
  for (const p of patterns) {
    const m = head.match(p);
    if (m) {
      if (m[2] && m[3]) {
        // Chinese or slash format — normalize to ISO
        return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
      }
      return m[1]; // already ISO
    }
  }
  return null;
}
