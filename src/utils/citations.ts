const CACHE_KEY = 'arxiv_citations_v1';
const TTL       = 24 * 60 * 60 * 1000; // 24 h

interface CacheEntry { count: number; ts: number }
type Cache = Record<string, CacheEntry>;

function load(): Cache {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}'); } catch { return {}; }
}
function save(c: Cache) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

export async function fetchCitationCounts(arxivIds: string[]): Promise<Record<string, number>> {
  if (!arxivIds.length) return {};
  const cache  = load();
  const now    = Date.now();
  const result: Record<string, number> = {};
  const needed: string[] = [];

  for (const id of arxivIds) {
    const e = cache[id];
    if (e && now - e.ts < TTL) result[id] = e.count;
    else needed.push(id);
  }

  if (!needed.length) return result;

  try {
    const resp = await fetch(
      'https://api.semanticscholar.org/graph/v1/paper/batch?fields=citationCount',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: needed.map(id => `arXiv:${id}`) }),
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!resp.ok) return result;

    const rows: Array<{ citationCount?: number } | null> = await resp.json();
    for (let i = 0; i < needed.length; i++) {
      const count = rows[i]?.citationCount ?? 0;
      result[needed[i]] = count;
      cache[needed[i]]  = { count, ts: now };
    }
    save(cache);
  } catch {
    /* network error / rate-limit — return what we have */
  }

  return result;
}
