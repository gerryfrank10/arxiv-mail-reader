// Hugging Face papers proxy for the dashboard's company tabs.
//
// Most major labs publish their papers on Hugging Face, tagged with their
// organisation. The search endpoint returns each paper's submitting org, so we
// search the company name and keep only the papers their org actually posted —
// that lists a company's papers even when they aren't in the local library.
//
// Note: /api/papers?organization=… looks tempting but ignores the parameter,
// so search + org filtering is the reliable path.

const HF_SEARCH = 'https://huggingface.co/api/papers/search';
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

// Display name (as used by organizations.mjs) → search query + the HF org
// slugs that count as "papers by this company".
const COMPANY_ALIASES = {
  'Google DeepMind':        { query: 'DeepMind',       orgs: ['deepmind', 'google-deepmind'] },
  'Google':                 { query: 'Google',         orgs: ['google'] },
  'NVIDIA':                 { query: 'NVIDIA',         orgs: ['nvidia'] },
  'Meta':                   { query: 'Meta AI',        orgs: ['facebook', 'meta', 'metaresearch'] },
  'Microsoft':              { query: 'Microsoft',      orgs: ['microsoft'] },
  'OpenAI':                 { query: 'OpenAI',         orgs: ['openai'] },
  'Anthropic':              { query: 'Anthropic',      orgs: ['anthropic'] },
  'Apple':                  { query: 'Apple',          orgs: ['apple'] },
  'Amazon':                 { query: 'Amazon',         orgs: ['amazon', 'aws'] },
  'IBM Research':           { query: 'IBM',            orgs: ['ibm', 'ibm-granite'] },
  'Alibaba':                { query: 'Qwen',           orgs: ['qwen', 'alibabatongyilab', 'tongyi-mai', 'qwenbusinessunit'] },
  'ByteDance':              { query: 'ByteDance Seed', orgs: ['bytedance-seed', 'bytedance'] },
  'Tencent':                { query: 'Tencent',        orgs: ['tencent'] },
  'Baidu':                  { query: 'Baidu',          orgs: ['baidu'] },
  'DeepSeek':               { query: 'DeepSeek',       orgs: ['deepseek-ai'] },
  'Moonshot AI':            { query: 'Kimi',           orgs: ['moonshotai'] },
  'Mistral AI':             { query: 'Mistral',        orgs: ['mistralai'] },
  'Salesforce':             { query: 'Salesforce',     orgs: ['salesforce'] },
  'Adobe':                  { query: 'Adobe',          orgs: ['adobe'] },
  'Intel':                  { query: 'Intel',          orgs: ['intel'] },
  'Samsung':                { query: 'Samsung',        orgs: ['samsung'] },
  'Huawei':                 { query: 'Huawei',         orgs: ['huawei-noah', 'huawei'] },
  'Hugging Face':           { query: 'Hugging Face',   orgs: ['huggingface'] },
  'Cohere':                 { query: 'Cohere',         orgs: ['cohere'] },
  'xAI':                    { query: 'xAI',            orgs: ['xai-org', 'xai'] },
  'Allen Institute for AI': { query: 'Allen Institute', orgs: ['allenai'] },
  'Sony':                   { query: 'Sony',           orgs: ['sony'] },
};

// Companies offered as one-tap suggestions in the tab picker, even before any
// of their papers have been detected in the library.
export const SUGGESTED_COMPANIES = [
  'NVIDIA', 'DeepSeek', 'ByteDance', 'Moonshot AI', 'Google DeepMind', 'Meta',
  'OpenAI', 'Anthropic', 'Microsoft', 'Alibaba', 'Mistral AI', 'Hugging Face',
  'Apple', 'Amazon', 'Tencent', 'Baidu', 'xAI', 'Huawei',
];

function aliasFor(name) {
  const known = COMPANY_ALIASES[name];
  if (known) return known;
  // Unknown company: search its name and accept an org whose slug or display
  // name matches it.
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return { query: name, orgs: [slug, name.toLowerCase()] };
}

/**
 * Papers posted to Hugging Face by a company's org, newest first.
 * Returns slim records ready for the client; cached per company.
 */
export async function fetchHfCompanyPapers(name) {
  const company = String(name ?? '').trim();
  if (!company) return [];
  const cached = cache.get(company);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.papers;

  const { query, orgs } = aliasFor(company);
  const url = `${HF_SEARCH}?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'arxiv-reader/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Hugging Face search failed (${res.status})`);
  const items = await res.json();
  const allowed = new Set(orgs.map(o => o.toLowerCase()));

  const papers = [];
  for (const item of Array.isArray(items) ? items : []) {
    const p = item?.paper ?? item;
    const org = p?.organization;
    const orgName = String(org?.name ?? '').toLowerCase();
    const orgFull = String(org?.fullname ?? '').toLowerCase();
    if (!allowed.has(orgName) && !allowed.has(orgFull)) continue;
    const arxivId = String(p?.id ?? '').trim();
    if (!arxivId) continue;
    papers.push({
      arxivId,
      title: String(p?.title ?? '').trim(),
      abstract: String(p?.summary ?? '').trim(),
      authors: (Array.isArray(p?.authors) ? p.authors : [])
        .map(a => String(a?.name ?? '').trim()).filter(Boolean),
      publishedAt: p?.publishedAt ?? item?.publishedAt ?? null,
      upvotes: Number(p?.upvotes ?? 0),
      url: `https://huggingface.co/papers/${arxivId}`,
      organization: org?.fullname ?? company,
    });
  }
  papers.sort((a, b) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')));
  cache.set(company, { at: Date.now(), papers });
  if (cache.size > 100) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    cache.delete(oldest[0]);
  }
  return papers;
}