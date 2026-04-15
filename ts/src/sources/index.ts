/**
 * Source auto-registration — creates a SourceRegistry with all available sources.
 */

import { SourceRegistry } from '../registry.js';

// Import all sources
import { HackerNewsSource } from './hackernews.js';
import { RedditSource } from './reddit.js';
import { GitHubSource } from './github.js';
import { StackOverflowSource } from './stackoverflow.js';
import { DevtoSource } from './devto.js';
import { BraveSource } from './brave.js';
import { YouTubeSource } from './youtube.js';
import { WeChatSource } from './wechat.js';
import { WeiboSource } from './weibo.js';
import { ZhihuSource } from './zhihu.js';
import { XiaohongshuSource } from './xiaohongshu.js';
import { XSource } from './x.js';

/** All source classes, in registration order. */
const ALL_SOURCES = [
  // Core sources (always available, no auth)
  HackerNewsSource,
  RedditSource,
  GitHubSource,
  StackOverflowSource,
  DevtoSource,
  WeChatSource,

  // Sources requiring API keys
  BraveSource,

  // Sources requiring optional deps
  YouTubeSource,

  // Browser/subprocess sources (need cookies or external CLI)
  WeiboSource,
  ZhihuSource,
  XiaohongshuSource,
  XSource,
];

/**
 * Create a SourceRegistry with all available sources registered.
 * Sources that fail to instantiate (e.g. missing optional deps) are silently skipped.
 */
export function createDefaultRegistry(): SourceRegistry {
  const registry = new SourceRegistry();

  for (const SourceClass of ALL_SOURCES) {
    try {
      registry.register(new SourceClass());
    } catch {
      // Skip sources that fail to instantiate
    }
  }

  return registry;
}

/** Re-export all source classes for direct use. */
export {
  HackerNewsSource,
  RedditSource,
  GitHubSource,
  StackOverflowSource,
  DevtoSource,
  BraveSource,
  YouTubeSource,
  WeChatSource,
  WeiboSource,
  ZhihuSource,
  XiaohongshuSource,
  XSource,
};
