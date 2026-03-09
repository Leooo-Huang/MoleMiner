# MoleMiner 设计讨论记录

日期：2026-03-09
来源：Radar 项目 Cursor 会话

---

## 讨论脉络

### 1. 起点：Radar Skill 搜索升级

Radar 是一个 OpenClaw Skill，自动搜索黑客松/政府资助/企业创新/加速器等机会。
现有搜索能力不足，想升级为"搜索引擎 + 社区双路径"。

### 2. 搜索双路径设计

两条路径互补：
- **搜索引擎路径**: Tavily / Google / Brave → 直接找到机会链接
- **社区路径**: Reddit / X / 知乎 / 小红书 / 微信公众号 → 找线索 → 再搜官方链接

### 3. 工具调研

调研了所有相关工具：
- **MediaCrawler** (45k stars): 覆盖知乎/小红书/微博等7平台，Playwright + Cookie，但许可证是非商业学习协议
- **last30days-openclaw** (MIT): 覆盖 Reddit/X/YouTube/HN，有完整 Python 脚本可复用
- **RSSHub** (35k stars): RSS 模式，不适合主动搜索
- **we-mp-rss**: 微信公众号监控
- **TikHub API**: 商业付费 API
- **SearXNG**: 不覆盖中文社区
- **Perplexica / GPT Researcher**: TypeScript，不是 SDK

### 4. 5 阶段管线设计

设计了完整的搜索管线：
1. LLM Query Enhancement — 根据平台特征生成不同搜索词
2. Parallel Dispatch — 并行搜索所有源
3. Aggregate — 去重、时效过滤、分类 (direct vs lead)
4. Lead Resolution — 社区线索追踪到官方链接
5. Output — 结构化输出

### 5. 独立项目决策

决定将搜索管线从 Radar 中独立出来，作为一个通用开源项目：
- Radar 是特定领域应用（项目机会扫描）
- MoleMiner 是通用搜索工具
- Radar 调用 MoleMiner，然后自己做评分和入库

### 6. 命名

经过多轮讨论：
- 最初想用"芝士雪豹"（丁真的梗）→ 国际用户不理解
- 改为"知识雪豹 / snowleo" → 还行但后来换方向
- 想要"钻地很深的小动物" → 鼹鼠 (Mole)
- "矿工鼹鼠"感觉 → MoleMiner
- 检查 PyPI/GitHub 可用性 → moleminer 未被占用
- 最终确定: **moleminer (矿鼹)**

### 7. 技术决策

- **语言**: Python（MediaCrawler/last30days 都是 Python，目标用户是开发者/研究者）
- **许可证**: MIT
- **代码来源**:
  - 国外社区: 复用 last30days 代码（MIT）
  - 国内社区: clean-room 实现（不能抄 MediaCrawler，非商业协议）
  - 其他: 自写
- **不用 LangChain**: Perplexica 已移除 LangChain 的教训
- **安装分层**: 零配置核心 + 可选 extras ([tavily], [brave], [social], [cn])

### 8. 插件架构

参考 SearXNG engine 模式 + Perplexica registry 模式：
- BaseSource ABC 定义统一接口
- SourceRegistry 管理所有源
- 每个源可通过 `enabled()` 动态启停
- 用户可自定义源

### 9. Source 详解

| Source | 方式 | 免费 | 需登录 |
|--------|------|------|--------|
| google.py | Web scraping | 是 | 否 |
| hackernews.py | Algolia API | 是 | 否 |
| jina.py | r.jina.ai | 是 | 否 |
| tavily.py | Tavily API | 有免费额度 | 否（API key） |
| brave.py | Brave API | 2000/月 | 否（API key） |
| reddit.py | ScrapeCreators | 取决 | 否（API key） |
| twitter.py | Bird Search | 取决 | 否（API key） |
| zhihu.py | Playwright | 是 | 是（Cookie） |
| xiaohongshu.py | Playwright | 是 | 是（Cookie） |
| weibo.py | Playwright | 是 | 是（Cookie） |
| wechat.py | 搜狗 scraping | 是 | 否 |

### 10. 关键调研发现

- **MediaCrawler 不能作为依赖**: 非商业许可证 + 不是 library + 太重
- **last30days 有完整可复用代码**: reddit.py, hackernews.py, brave_search.py, bird_x.py, dedupe.py, score.py 等，全部 MIT
- **HN 搜索零配置可用**: Algolia API 免费无需 key
- **没有竞品做同样的事**: LLM query 增强 + 多源并行 + 线索解析的 Python SDK 是空白

---

## 下一步

从 Phase 1 MVP 开始：
1. 项目脚手架（pyproject.toml, src layout, CLI）
2. BaseSource ABC + SourceRegistry
3. google.py + hackernews.py + jina.py
4. aggregate.py（基础去重）
5. CLI: `moleminer search "query"` → table/json 输出
6. 发布 PyPI
