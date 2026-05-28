// External data sources for the weekly Magazine.
//
// All four sources are FREE and require no API keys — just polite use:
//
//   * Hacker News    — official Firebase API, top + filter AI/ML keywords
//   * HuggingFace    — public /api/models?sort=trending
//   * GitHub         — public search API (rate-limited per IP)
//   * ModelScope     — public listings (Chinese but ML-heavy)
//
// Each function returns a normalised array of items. Results are cached
// in-memory for 1 hour so multiple magazine generations the same day
// don't re-hit the upstreams.

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map();

function memoize(key, fn) {
  return async () => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;
    const data = await fn();
    cache.set(key, { data, ts: Date.now() });
    return data;
  };
}

// =========================================================================
// Hacker News — top stories filtered to AI/ML keywords
// =========================================================================

const ML_KEYWORDS = /(\b(AI|LLM|RAG|ML|GPT|GPU|TPU|Claude|Gemini|Llama|Mistral|Qwen|DeepSeek|OpenAI|Anthropic|HuggingFace|PyTorch|TensorFlow|JAX|MLX|transformer|diffusion|embedding|neural|reasoning|alignment|inference|fine-?tune|prompt|agent|retrieval|chunking|tokenis|model context|MoE|mixture of experts|world model|reinforcement learning|self.?supervised)\b)/i;

export const fetchHackerNewsTop = memoize('hn:top', async () => {
  // Top story IDs (returns up to 500, we take first 100)
  const ids = await (await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', { signal: AbortSignal.timeout(10_000) })).json();
  const top = ids.slice(0, 100);
  // Fetch each in parallel (it's a CDN-backed JSON API, fine)
  const items = await Promise.all(top.map(async (id) => {
    try {
      const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { signal: AbortSignal.timeout(8_000) });
      if (!r.ok) return null;
      const it = await r.json();
      return it;
    } catch { return null; }
  }));
  const filtered = items
    .filter(it => it && it.type === 'story' && it.title)
    .filter(it => ML_KEYWORDS.test(`${it.title} ${it.url ?? ''}`))
    .slice(0, 12)
    .map(it => ({
      id:          `hn-${it.id}`,
      title:       it.title,
      url:         it.url ?? `https://news.ycombinator.com/item?id=${it.id}`,
      discussion:  `https://news.ycombinator.com/item?id=${it.id}`,
      points:      it.score ?? 0,
      comments:    it.descendants ?? 0,
      by:          it.by ?? '',
      ts:          (it.time ?? 0) * 1000,
    }));
  return filtered;
});

// =========================================================================
// HuggingFace — trending models
// =========================================================================

export const fetchHuggingFaceTrending = memoize('hf:trending', async () => {
  // 'trendingScore' is HF's actual trending metric (the API rejects
  // 'trending'). Use likes30d as a fallback if trendingScore is ever
  // removed.
  const r = await fetch(
    'https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=20',
    { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) },
  );
  if (!r.ok) throw new Error(`HuggingFace ${r.status}`);
  const data = await r.json();
  return (Array.isArray(data) ? data : []).slice(0, 12).map(m => ({
    id:          `hf-${m.id ?? m.modelId}`,
    name:        m.id ?? m.modelId,
    author:      (m.id ?? m.modelId ?? '').split('/')[0] ?? '',
    downloads:   m.downloads ?? 0,
    likes:       m.likes ?? 0,
    tags:        (m.tags ?? []).slice(0, 6),
    pipeline:    m.pipeline_tag ?? null,
    library:     m.library_name ?? null,
    url:         `https://huggingface.co/${m.id ?? m.modelId}`,
    ts:          m.createdAt ? new Date(m.createdAt).getTime() : 0,
  }));
});

// =========================================================================
// GitHub — trending in the past week
// =========================================================================

export const fetchGitHubTrending = memoize('gh:trending', async () => {
  // GitHub doesn't expose a "trending" endpoint; instead we ask for
  // repos created in the last 7 days with a star floor and let GitHub
  // sort by star count. The `+` separators between qualifiers stay
  // literal in the URL — they're query operators, not URL-encoding.
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const q = `created:>${since}+stars:>50`;
  const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=20`;
  const r = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'arxiv-mail-reader/1.0',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const data = await r.json();
  return (data.items ?? []).slice(0, 10).map(repo => ({
    id:          `gh-${repo.id}`,
    name:        repo.full_name,
    description: repo.description ?? '',
    url:         repo.html_url,
    stars:       repo.stargazers_count ?? 0,
    forks:       repo.forks_count ?? 0,
    language:    repo.language ?? 'unknown',
    topics:      (repo.topics ?? []).slice(0, 6),
    ts:          repo.created_at ? new Date(repo.created_at).getTime() : 0,
    owner:       repo.owner?.login ?? '',
    ownerAvatar: repo.owner?.avatar_url ?? null,
  }));
});

// =========================================================================
// ModelScope — trending models
// =========================================================================

export const fetchModelScopeTrending = memoize('ms:trending', async () => {
  // ModelScope's hub listing is a POST with a JSON body. The endpoint
  // is undocumented and changes occasionally; we tolerate failures
  // gracefully so the magazine still renders without it.
  const candidateEndpoints = [
    {
      url:  'https://www.modelscope.cn/api/v1/dolphin/models',
      body: { PageSize: 12, PageNumber: 1, SortBy: 'Default' },
      pick: (d) => d?.Data?.Model?.Models ?? [],
    },
    {
      url:  'https://www.modelscope.cn/api/v1/models',
      body: { PageSize: 12, PageNumber: 1, SortBy: 'Hottest' },
      pick: (d) => d?.Data?.Model?.Models ?? d?.data?.models ?? [],
    },
  ];
  for (const ep of candidateEndpoints) {
    try {
      const r = await fetch(ep.url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'arxiv-mail-reader/1.0',
        },
        body: JSON.stringify(ep.body),
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) continue;
      const data = await r.json();
      const items = ep.pick(data);
      if (!Array.isArray(items) || items.length === 0) continue;
      return items.slice(0, 10).map(m => ({
        id:          `ms-${m.Id ?? m.id}`,
        name:        m.Name ?? m.name ?? '',
        chineseName: m.ChineseName ?? '',
        author:      m.OrganizationName ?? m.organization_name ?? '',
        downloads:   m.Downloads ?? m.downloads ?? 0,
        stars:       m.Stars ?? m.stars ?? 0,
        tags:        Array.isArray(m.Tags) ? m.Tags.slice(0, 6) : [],
        url:         `https://www.modelscope.cn/models/${m.Path ?? m.path ?? `${m.OrganizationName}/${m.Name}`}`,
        ts:          m.CreatedTime ? new Date(m.CreatedTime).getTime() : 0,
      }));
    } catch { /* try next endpoint */ }
  }
  // Both endpoints failed — return an empty list rather than throwing
  // so the magazine still generates with the other sources intact.
  return [];
});

// =========================================================================
// AI news — aggregated from RSS feeds (no API key required)
// =========================================================================

// Minimal HTML-entity decoder for feed titles (&amp; &#39; &quot; …).
function decodeEntities(s) {
  if (!s) return '';
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/<[^>]+>/g, '')   // strip any leftover tags (descriptions)
    .replace(/\s+/g, ' ')
    .trim();
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1].trim() : '';
};

// Parse an RSS 2.0 / Atom feed into normalised items. Handles <item> (RSS)
// and <entry> (Atom). Returns { title, url, source, summary, ts }.
function parseFeed(xml, fallbackSource) {
  const items = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  for (const block of blocks) {
    let title = decodeEntities(tag(block, 'title'));
    if (!title) continue;

    // Link: RSS uses <link>url</link>; Atom uses <link href="url"/>
    let url = decodeEntities(tag(block, 'link'));
    if (!url) {
      const hrefM = block.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i);
      if (hrefM) url = hrefM[1];
    }

    const dateStr = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated');
    const ts = dateStr ? new Date(dateStr).getTime() || 0 : 0;

    // Google News tags each item with its origin <source url="…">Name</source>
    const sourceM = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    const source = sourceM ? decodeEntities(sourceM[1]) : fallbackSource;

    // Google News appends " - <Outlet>" to every title — strip it since we
    // surface the outlet separately as `source`.
    if (source) title = title.replace(new RegExp(`\\s*[-–|]\\s*${escapeRegExp(source)}\\s*$`), '').trim();

    // Google News descriptions are just the linked title repeated, which is
    // noise. Drop a summary that merely echoes the title.
    let summary = decodeEntities(tag(block, 'description') || tag(block, 'summary')).slice(0, 200);
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (summary && norm(summary).startsWith(norm(title))) summary = '';

    items.push({ title, url, source, summary, ts });
  }
  return items;
}

const NEWS_FEEDS = [
  // Google News aggregates AI coverage across many reputable outlets and is
  // very reliable; the when:7d operator keeps it to the past week.
  {
    name: 'Google News',
    url:  'https://news.google.com/rss/search?q=' +
          encodeURIComponent('(artificial intelligence OR LLM OR "machine learning" OR OpenAI OR Anthropic) when:7d') +
          '&hl=en-US&gl=US&ceid=US:en',
  },
  // VentureBeat's AI section as a secondary, direct feed.
  { name: 'VentureBeat', url: 'https://venturebeat.com/category/ai/feed/' },
];

export const fetchAINews = memoize('news:ai', async () => {
  const perFeed = await Promise.all(NEWS_FEEDS.map(async (f) => {
    try {
      const r = await fetch(f.url, {
        headers: { 'User-Agent': 'arxiv-mail-reader/1.0', Accept: 'application/rss+xml, application/xml, text/xml' },
        signal:  AbortSignal.timeout(12_000),
      });
      if (!r.ok) return [];
      return parseFeed(await r.text(), f.name);
    } catch { return []; }
  }));

  // Merge, drop items older than ~8 days, dedupe by normalised title, sort by recency.
  const cutoff = Date.now() - 8 * 24 * 60 * 60 * 1000;
  const seen = new Set();
  const merged = [];
  for (const item of perFeed.flat()) {
    if (item.ts && item.ts < cutoff) continue;
    const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  merged.sort((a, b) => b.ts - a.ts);

  if (merged.length === 0) throw new Error('No news items returned from any feed');

  return merged.slice(0, 12).map((it, i) => ({
    id:      `news-${i}-${it.ts || Date.now()}`,
    title:   it.title,
    url:     it.url,
    source:  it.source,
    summary: it.summary,
    ts:      it.ts,
  }));
});

// =========================================================================
// Unified fetcher with per-source toggle
// =========================================================================

export async function fetchSources(enabledSources) {
  // Run all selected sources in parallel, tolerating individual failures.
  const tasks = [];
  if (enabledSources.includes('hackernews'))   tasks.push(['hackernews',   fetchHackerNewsTop().catch(e => ({ __error: e.message }))]);
  if (enabledSources.includes('news'))         tasks.push(['news',         fetchAINews().catch(e => ({ __error: e.message }))]);
  if (enabledSources.includes('huggingface'))  tasks.push(['huggingface',  fetchHuggingFaceTrending().catch(e => ({ __error: e.message }))]);
  if (enabledSources.includes('github'))       tasks.push(['github',       fetchGitHubTrending().catch(e => ({ __error: e.message }))]);
  if (enabledSources.includes('modelscope'))   tasks.push(['modelscope',   fetchModelScopeTrending().catch(e => ({ __error: e.message }))]);

  const results = {};
  const errors  = {};
  for (const [name, p] of tasks) {
    const r = await p;
    if (r?.__error) errors[name] = r.__error;
    else            results[name] = r;
  }
  return { results, errors };
}
