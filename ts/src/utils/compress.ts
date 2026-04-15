/**
 * Rule-based content compression pipeline.
 *
 * Priority: KEY INFORMATION MUST NEVER BE LOST > minimize content length.
 *
 * Design: each rule runs sequentially. After each step, a safety check verifies
 * that the compression ratio hasn't exceeded the threshold (default 70% removed).
 * If a single step removes too much, it is rolled back and the previous result is kept.
 *
 * Rules are ordered from safest (lowest false-positive risk) to most aggressive.
 */

export interface CompressOptions {
  /** Content language: 'zh' for Chinese, 'en' for English, auto-detected if omitted. */
  language?: string;
  /** Maximum allowed compression per step (0-1). Default 0.7 = any step that removes >70% is rolled back. */
  maxStepCompressionRatio?: number;
}

type CompressRule = (text: string, lang: string) => string;

/**
 * Compress extracted text using rule-based pipeline.
 * Returns compressed text. Never returns empty string if input was non-empty.
 */
export function compressText(text: string, options: CompressOptions = {}): string {
  if (!text || text.trim().length === 0) return '';

  const rawLang = options.language ?? detectLang(text);
  // Normalize: 'zh-CN', 'zh-TW', 'zh-Hans' → 'zh'; anything else → 'en'
  const lang = rawLang.startsWith('zh') ? 'zh' : 'en';
  const maxRatio = options.maxStepCompressionRatio ?? 0.70;

  const rules: Array<{ name: string; fn: CompressRule }> = [
    // P0: Safest rules — almost zero false-positive risk
    { name: 'collapseWhitespace',    fn: collapseWhitespace },
    { name: 'removeDuplicateLines',  fn: removeDuplicateLines },
    { name: 'removeTemplateBoilerplate', fn: removeTemplateBoilerplate },
    { name: 'removeHighLinkDensity', fn: removeHighLinkDensityLines },
    { name: 'removeIsolatedShortLines', fn: removeIsolatedShortLines },

    // P1: Platform-specific Chinese noise
    { name: 'removeChinesePlatformNoise', fn: removeChinesePlatformNoise },

    // P1: Structural cleanup
    { name: 'removeRelatedContentTail', fn: removeRelatedContentTail },
    { name: 'removeNavigationResidue', fn: removeNavigationResidue },

    // P2: Final cleanup
    { name: 'collapseBlankLines',    fn: collapseBlankLines },
  ];

  let result = text;

  for (const rule of rules) {
    const before = result;
    const after = rule.fn(result, lang);

    // Safety check: if this step removed too much, roll back
    if (before.length > 0 && after.trim().length > 0) {
      const removed = 1 - (after.length / before.length);
      if (removed > maxRatio) {
        // This step was too aggressive — skip it
        continue;
      }
      result = after;
    }
    // If after is empty but before wasn't, skip this rule (never produce empty output)
    else if (after.trim().length === 0 && before.trim().length > 0) {
      continue;
    } else {
      result = after;
    }
  }

  return result.trim();
}

// ─── P0 Rules ────────────────────────────────────────────────────────────────

/** Collapse runs of whitespace within lines; trim each line. */
function collapseWhitespace(text: string): string {
  return text
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .join('\n');
}

/** Remove exact-duplicate lines (keep first occurrence). */
function removeDuplicateLines(text: string): string {
  const seen = new Set<string>();
  return text
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return true; // keep blank lines for now
      if (seen.has(trimmed)) return false;
      seen.add(trimmed);
      return true;
    })
    .join('\n');
}

/**
 * Remove common template/boilerplate phrases.
 * These appear across many websites and never contain useful content.
 */
function removeTemplateBoilerplate(text: string, lang: string): string {
  // Universal patterns (appear in both zh and en)
  const universalPatterns = [
    /^share\s*(on|to|this|via)\b.*$/i,
    /^(copyright|©)\s*\d{4}.*$/i,
    /^all rights reserved\.?$/i,
    /^powered by\s+.*$/i,
    /^\d+\s*(views?|reads?|clicks?)\s*$/i,
  ];

  // Chinese-specific boilerplate
  const zhPatterns = [
    /^分享到\s*[:：]?\s*.*$/,
    /^点击(查看|阅读|展开|关注|订阅).*$/,
    /^(关注|订阅)(我们|公众号).*$/,
    /^转载(请|须)(注明|标注).*$/,
    /^版权(所有|归|声明).*$/,
    /^(免责|法律)(声明|申明).*$/,
    /^(上一篇|下一篇|上一条|下一条)\s*[:：]?\s*.*$/,
    /^(首页|返回首页|回到顶部)\s*$/,
    /^(扫码|扫一扫)(关注|查看|下载).*$/,
    /^本文(来自|来源|转自|出处)\s*[:：]?\s*.*$/,
    /^(阅读|浏览)(原文|全文|更多).*$/,
    /^(声明|免责)\s*[:：]\s*.*$/,
    /^(编辑|责编|责任编辑|作者)\s*[:：]\s*.{1,20}$/,
    /^(来源|出处)\s*[:：]\s*.{1,30}$/,
    // Government site accessibility/language toggles (with or without list markers)
    /^[-·*]?\s*无障碍(浏览|阅读)?\s*\|?\s*$/,
    /^[-·*]?\s*繁體版\s*\|?\s*$/,
    /^[-·*]?\s*(简体|繁体|English)\s*\|?\s*$/,
    // Government site chrome
    /【字体：.*?】/,
    /视力保护色\s*[:：]/,
    /^\*?(索\s*引\s*号|分\s*类|发布机构|发布日期|名\s*称|文\s*号)\*?\s*[:：]\s*$/,
    /^(信息来源|信息提供日期)\s*[:：].*$/,
    // AI脑图 and other interactive controls
    /^AI脑图\s*/,
    /^\*?(小|中|大)\*?$/,
  ];

  // English-specific boilerplate
  const enPatterns = [
    /^(read|click|tap)\s+(more|here|to\s+continue).*$/i,
    /^(subscribe|follow|sign up)(\s+(to|for|us))?.*$/i,
    /^(tags?|categories?|topics?)\s*[:：]\s*.*$/i,
    /^(previous|next)\s*(post|article|page)\s*[:：]?\s*.*$/i,
    /^(author|editor|writer|by)\s*[:：]\s*.{1,30}$/i,
    /^(source|via)\s*[:：]\s*.{1,30}$/i,
    /^(leave|write|add)\s+a?\s*(comment|reply|response).*$/i,
    /^(table of contents|contents)$/i,
  ];

  const patterns = [
    ...universalPatterns,
    ...(lang === 'zh' ? zhPatterns : enPatterns),
  ];

  return text
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return true;
      return !patterns.some(p => p.test(trimmed));
    })
    .join('\n');
}

/**
 * Remove lines where >50% of the text is inside markdown links.
 * These are typically navigation bars, link lists, or tag clouds.
 *
 * After Defuddle/Readability extraction, links appear as markdown [text](url).
 */
function removeHighLinkDensityLines(text: string): string {
  return text
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      if (trimmed.length < 10) return true; // too short to judge

      // Count characters inside markdown links: [text](url)
      const linkMatches = trimmed.match(/\[([^\]]*)\]\([^)]*\)/g) || [];
      const linkCharCount = linkMatches.reduce((sum, m) => sum + m.length, 0);
      const linkDensity = linkCharCount / trimmed.length;

      return linkDensity <= 0.5;
    })
    .join('\n');
}

/**
 * Remove isolated short lines (not adjacent to content paragraphs).
 *
 * "Isolated" = the line before AND after are both blank or also short.
 * This catches stray button labels, menu items, and UI chrome that survived extraction.
 *
 * Threshold: 10 chars for Chinese, 30 chars for English.
 *
 * IMPORTANT: Does NOT remove short lines that are:
 * - Part of a list (starts with -, *, •, numbers)
 * - A heading (starts with #)
 * - Inside a sequence of short lines (table-like content)
 */
function removeIsolatedShortLines(text: string, lang: string): string {
  const threshold = lang === 'zh' ? 10 : 30;
  const lines = text.split('\n');
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Always keep blank lines, headings, list items
    if (
      line.length === 0 ||
      line.startsWith('#') ||
      /^[-*•\d]/.test(line) ||
      /^[（(]\d+[）)]/.test(line) || // Chinese numbered items like （一）
      /^第[一二三四五六七八九十百千]+[条章节款项]/.test(line) // Chinese legal clauses
    ) {
      result.push(lines[i]);
      continue;
    }

    // Check if this is a short line
    if (line.length < threshold) {
      const prevLine = (i > 0 ? lines[i - 1].trim() : '');
      const nextLine = (i < lines.length - 1 ? lines[i + 1].trim() : '');

      // "Isolated" = prev and next are blank or also short non-content
      const prevIsContent = prevLine.length >= threshold;
      const nextIsContent = nextLine.length >= threshold;

      if (!prevIsContent && !nextIsContent) {
        // Isolated short line — likely UI chrome, skip it
        continue;
      }
    }

    result.push(lines[i]);
  }

  return result.join('\n');
}

// ─── P1 Rules ────────────────────────────────────────────────────────────────

/**
 * Chinese platform-specific noise removal.
 *
 * Patterns known from:
 * - WeChat public accounts (微信公众号)
 * - Zhihu (知乎)
 * - Xiaohongshu (小红书)
 * - Weibo (微博)
 * - Government websites (政府网站)
 */
function removeChinesePlatformNoise(text: string, lang: string): string {
  if (lang !== 'zh') return text;

  const noisePatterns = [
    // Government breadcrumbs
    /^您(当前|所在)(的)?位置\s*[:：].*$/,
    /^当前位置\s*[:：].*$/,
    /^首页\s*[>›»→]\s*/,

    // WeChat
    /^(微信扫一扫|长按识别|关注该公众号).*$/,
    /^(原创|原文).*?\d{4}[-年]\d{1,2}[-月]\d{1,2}.*$/,

    // Zhihu
    /^\d+\s*个?(赞同|回答|评论|关注)$/,
    /^(添加评论|写下你的评论|发布评论).*$/,
    /^(关注问题|写回答|邀请回答).*$/,
    /^(登录|注册)(后)?.*?(查看|回答|评论|赞同).*$/,

    // Xiaohongshu hashtag clusters (3+ hashtags on one line)
    /^(#[^\s#]+\s*){3,}$/,

    // Weibo
    /^(转发|评论|赞)\s*\d*\s*$/,
    /^(同时转发到|发布到|特别声明).*$/,

    // Common Chinese web noise
    /^(收藏|举报|投诉|反馈)\s*$/,
    /^(相关|推荐|猜你喜欢|大家都在看|热门|精彩|精选)\s*(内容|文章|推荐|阅读)?$/,
    /^(加载中|正在加载|loading).*$/i,
    /^(展开全文|收起|显示更多|查看更多|查看全部)$/,
    /^(网友评论|用户评论|最新评论|热门评论).*$/,
  ];

  return text
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return true;
      return !noisePatterns.some(p => p.test(trimmed));
    })
    .join('\n');
}

/**
 * Detect and truncate "related content" tail sections.
 *
 * Many pages have a "Related articles" / "推荐阅读" section at the end
 * that is just a list of links. Once we hit such a heading, everything after is noise.
 *
 * Safety: only truncates if the heading appears in the LAST 30% of the text.
 */
function removeRelatedContentTail(text: string, lang: string): string {
  const lines = text.split('\n');

  // Patterns that mark the start of "related content"
  const tailPatterns = lang === 'zh'
    ? [
      /^#+\s*(相关|推荐|猜你喜欢|延伸|拓展)(阅读|文章|内容|推荐|链接)/,
      /^(相关|推荐|猜你喜欢|延伸|拓展)(阅读|文章|内容|推荐|链接)\s*[:：]?\s*$/,
      /^(你可能还喜欢|大家还在看|相关报道)\s*$/,
    ]
    : [
      /^#+\s*(related|recommended|you (might|may) (also )?(like|enjoy)|see also|further reading)/i,
      /^(related|recommended)\s+(articles?|posts?|reading|content|links?)\s*[:：]?\s*$/i,
      /^(you (might|may) (also )?(like|enjoy)|see also|further reading)\s*$/i,
    ];

  // Only look in the last 30% of lines
  const cutoffIndex = Math.floor(lines.length * 0.7);

  for (let i = cutoffIndex; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (tailPatterns.some(p => p.test(trimmed))) {
      // Found the related content heading — truncate everything from here
      return lines.slice(0, i).join('\n');
    }
  }

  return text;
}

/**
 * Remove navigation residue: lines that look like breadcrumb trails or menu items.
 */
function removeNavigationResidue(text: string): string {
  return text
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return true;

      // Breadcrumb pattern: "Home > Category > Page" or "首页 > 政策 > 通知"
      const separatorCount = (trimmed.match(/[>›»→|]/g) || []).length;
      const segments = trimmed.split(/[>›»→|]/);
      if (separatorCount >= 2 && segments.every(s => s.trim().length < 20)) {
        return false;
      }

      return true;
    })
    .join('\n');
}

// ─── P2: Final cleanup ───────────────────────────────────────────────────────

/** Collapse 3+ consecutive blank lines into 1. */
function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function detectLang(text: string): string {
  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  return cjkCount / Math.max(text.length, 1) > 0.1 ? 'zh' : 'en';
}
