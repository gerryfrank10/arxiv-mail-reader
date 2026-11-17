// Nobel Prize laureates — proxied from the official Nobel Prize API
// (api.nobelprize.org, 2.1). The full dataset is ~4 MB of JSON; we normalize
// it into a compact year→award→laureate structure and cache it in memory plus
// on disk so container restarts don't re-download it. The dataset only changes
// once a year (announcements in October), so a generous TTL is safe.

const API_URL = 'https://api.nobelprize.org/2.1/laureates?limit=2000';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

// Official ceremony presentation order.
const CATEGORY_ORDER = [
  'Physics',
  'Chemistry',
  'Physiology or Medicine',
  'Literature',
  'Peace',
  'Economic Sciences',
];

export function normalizeNobelResponse(api) {
  const laureates = Array.isArray(api?.laureates) ? api.laureates : [];
  const byYear = new Map();

  for (const person of laureates) {
    const id = String(person.id ?? '');
    const name = person.knownName?.en ?? person.fullName?.en
      ?? [person.givenName?.en, person.familyName?.en].filter(Boolean).join(' ')
      ?? 'Unknown';
    const birthYear = person.birth?.date ? String(person.birth.date).slice(0, 4) : null;
    const deathYear = person.death?.date ? String(person.death.date).slice(0, 4) : null;
    const country = person.birth?.place?.countryNow?.en ?? person.birth?.place?.country?.en ?? null;
    const wikipedia = person.wikipedia?.english ?? null;

    for (const prize of Array.isArray(person.nobelPrizes) ? person.nobelPrizes : []) {
      const category = prize.category?.en ?? null;
      const year = Number(prize.awardYear);
      if (!category || !CATEGORY_ORDER.includes(category) || !Number.isFinite(year)) continue;
      const external = (prize.links ?? []).find(
        link => link.rel === 'external' && (link.class ?? []).includes('laureate facts'),
      );
      const award = {
        id,
        name,
        portion: String(prize.portion ?? '1'),
        motivation: String(prize.motivation?.en ?? '').trim(),
        nobelUrl: external?.href ?? null,
        wikipedia,
        birthYear,
        deathYear,
        country,
      };
      let entry = byYear.get(year);
      if (!entry) { entry = new Map(); byYear.set(year, entry); }
      let list = entry.get(category);
      if (!list) { list = []; entry.set(category, list); }
      list.push(award);
    }
  }

  const years = [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, awards]) => ({
      year,
      awards: CATEGORY_ORDER
        .filter(category => awards.has(category))
        .map(category => ({ category, laureates: awards.get(category) })),
    }));

  return {
    fetchedAt: new Date().toISOString(),
    total: laureates.length,
    years,
  };
}

// Cache precedence: fresh in-memory → fresh on-disk → fetch (falling back to
// a stale on-disk copy if the API is unreachable). Errors propagate only when
// no cached copy exists at all.
let memoryCache = null;

async function readDiskCache(cacheFile) {
  const { readFile } = await import('node:fs/promises');
  try {
    return JSON.parse(await readFile(cacheFile, 'utf8'));
  } catch {
    return null;
  }
}

async function writeDiskCache(cacheFile, data) {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  try {
    await mkdir(dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, JSON.stringify(data));
  } catch (error) {
    console.warn(`[nobel] cache write failed: ${error.message}`);
  }
}

function ageOf(data) {
  if (!data?.fetchedAt) return Infinity;
  return Date.now() - new Date(data.fetchedAt).getTime();
}

export async function getNobelLaureates({ cacheFile, fetchImpl = fetch, now = Date.now } = {}) {
  if (memoryCache && now() - new Date(memoryCache.fetchedAt).getTime() < CACHE_TTL_MS) {
    return memoryCache;
  }

  const disk = await readDiskCache(cacheFile);
  if (disk && now() - new Date(disk.fetchedAt).getTime() < CACHE_TTL_MS) {
    memoryCache = disk;
    return disk;
  }

  try {
    const response = await fetchImpl(API_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Nobel Prize API returned HTTP ${response.status}`);
    const normalized = normalizeNobelResponse(await response.json());
    if (normalized.years.length === 0) throw new Error('Nobel Prize API returned no laureates');
    memoryCache = normalized;
    await writeDiskCache(cacheFile, normalized);
    return normalized;
  } catch (error) {
    if (disk) {
      console.warn(`[nobel] fetch failed (${error.message}); serving cached copy from ${new Date(disk.fetchedAt).toISOString()}`);
      memoryCache = disk;
      return disk;
    }
    throw error;
  }
}
