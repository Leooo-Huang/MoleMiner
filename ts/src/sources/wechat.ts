/** WeChat Official Account search via Sogou WeChat (no auth required). */

import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { Config } from '../config.js';
import type { SearchResult } from '../models.js';
import { BaseSource } from './base.js';
import { fetchText, BROWSER_UA } from '../utils/http.js';

const SEARCH_URL = 'https://weixin.sogou.com/weixin';

const BROWSER_HEADERS = {
  'User-Agent': BROWSER_UA,
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Referer: 'https://weixin.sogou.com/',
};

export class WeChatSource extends BaseSource {
  readonly name = 'wechat';
  readonly sourceType = 'scrape' as const;
  readonly requiresAuth = false;

  enabled(_config: Config): boolean {
    return true;
  }

  protected override async searchOne(query: string): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      type: '2',
      query,
      ie: 'utf8',
      s_from: 'input',
    });
    const url = `${SEARCH_URL}?${params}`;

    let html: string;
    try {
      html = await fetchText(url, { headers: BROWSER_HEADERS });
    } catch (e) {
      throw new Error(`wechat: fetch failed: ${(e as Error).message}`);
    }

    // Anti-spider check
    if (html.includes('/antispider/')) {
      throw new Error('wechat: blocked by anti-bot (sogou antispider redirect)');
    }

    return this._parseHtml(html);
  }

  /** Parse Sogou WeChat search results page using cheerio. */
  _parseHtml(html: string): SearchResult[] {
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    // Try primary selector: <li id="sogou_vr_...">
    let items = $('li[id^="sogou_vr_"]');

    // Fallback: <div class="txt-box">
    if (items.length === 0) {
      items = $('div.txt-box');
    }

    items.each((_i, el) => {
      const $el = $(el);
      const result = this._parseItem($, $el);
      if (result) results.push(result);
    });

    return results;
  }

  private _parseItem(
    $: cheerio.CheerioAPI,
    $el: cheerio.Cheerio<AnyNode>,
  ): SearchResult | null {
    // Extract URL
    let itemUrl = $el.find('a[href]').first().attr('href') ?? '';
    if (!itemUrl) return null;
    if (itemUrl.startsWith('/')) {
      itemUrl = `https://weixin.sogou.com${itemUrl}`;
    }

    // Extract title from h3
    const h3 = $el.find('h3').first();
    let title = h3.text().trim();
    if (!title) {
      // Fallback: try first <a> with text
      $el.find('a').each((_i, a) => {
        const text = $(a).text().trim();
        if (text && !title) title = text;
      });
    }
    if (!title) return null;
    // cheerio .text() already decodes HTML entities

    // Extract snippet
    let snippet = $el.find('p.txt-info').first().text().trim();
    if (!snippet) {
      snippet = $el.find('p[class*="txt"]').first().text().trim();
    }

    // Extract timestamp from timeConvert('XXXXXXXXXX') pattern
    const elHtml = $.html($el);
    let timestamp: string | undefined;
    const tsMatch = elHtml.match(/timeConvert\(['"](\d{10,})['"]\)/);
    if (tsMatch) {
      timestamp = tsMatch[1];
    }

    return {
      title,
      url: itemUrl,
      source: 'wechat',
      snippet: snippet.slice(0, 300),
      resultType: 'lead',
      language: 'zh',
      timestamp,
    };
  }
}
