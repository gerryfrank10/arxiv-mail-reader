import { useState, useEffect, useMemo, useRef } from 'react';
import { Medal, Search, AlertCircle, ExternalLink, BookOpen, X, ChevronDown, Trophy } from 'lucide-react';
import { apiGetNobelLaureates, NobelData, NobelLaureate, NobelAward } from '../utils/nobelApi';
import Pager from './Pager';
import { usePagination } from '../hooks/usePagination';

const CATEGORIES = ['Physics', 'Chemistry', 'Physiology or Medicine', 'Literature', 'Peace', 'Economic Sciences'];

const CATEGORY_CHIP: Record<string, string> = {
  'Physics':                'bg-amber-100 text-amber-800 border-amber-200',
  'Chemistry':              'bg-emerald-100 text-emerald-800 border-emerald-200',
  'Physiology or Medicine': 'bg-rose-100 text-rose-800 border-rose-200',
  'Literature':             'bg-violet-100 text-violet-800 border-violet-200',
  'Peace':                  'bg-sky-100 text-sky-800 border-sky-200',
  'Economic Sciences':      'bg-indigo-100 text-indigo-800 border-indigo-200',
};

export default function NobelView() {
  const [data, setData]       = useState<NobelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [query, setQuery]     = useState('');
  const [category, setCategory] = useState<string>('All');
  const [openYear, setOpenYear] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiGetNobelLaureates()
      .then(d => {
        if (cancelled) return;
        setData(d);
        // Expand the most recent year by default.
        setOpenYear(d.years[0]?.year ?? null);
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load Nobel Prize data'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  // Laureates who won more than once (Curie, Pauling, Bardeen, …) get a badge.
  const prizeCountById = useMemo(() => {
    const counts = new Map<string, number>();
    for (const year of data?.years ?? []) {
      for (const award of year.awards) {
        for (const laureate of award.laureates) {
          counts.set(laureate.id, (counts.get(laureate.id) ?? 0) + 1);
        }
      }
    }
    return counts;
  }, [data]);

  const filtering = query.trim().length > 0 || category !== 'All';

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.years
      .filter(year => category === 'All' || year.awards.some(a => a.category === category))
      .map(year => ({
        year: year.year,
        awards: year.awards
          .filter(a => category === 'All' || a.category === category)
          .map(a => ({
            ...a,
            laureates: a.laureates.filter(l =>
              !q
              || l.name.toLowerCase().includes(q)
              || l.motivation.toLowerCase().includes(q)
              || (l.country ?? '').toLowerCase().includes(q)
              || String(year.year).includes(q)
            ),
          }))
          .filter(a => a.laureates.length > 0),
      }))
      .filter(y => y.awards.length > 0);
  }, [data, query, category]);

  const matchCount = filtered.reduce((sum, y) => sum + y.awards.reduce((s, a) => s + a.laureates.length, 0), 0);

  // Paginate the year list in both browse and filter modes.
  const displayYears = data ? (filtering ? filtered : data.years) : [];
  const pagination   = usePagination(displayYears, 20);
  const visibleYears = pagination.slice;
  const scrollRef    = useRef<HTMLDivElement>(null);

  // Jump back to the top when the page changes so the user sees the new years.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [pagination.page]);

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto main-scroll">
      <div className="max-w-5xl mx-auto px-8 py-8 fade-in">
        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-yellow-600 flex items-center justify-center text-white shadow-sm">
            <Medal size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Nobel Prize</h1>
            <p className="text-sm text-slate-500">Every laureate since 1901 — Physics, Chemistry, Medicine, Literature, Peace, and Economic Sciences.</p>
          </div>
        </div>
        {data && (
          <p className="text-xs text-slate-400 mb-6">
            Source: NobelPrize.org official API · {data.total.toLocaleString()} laureates · updated {new Date(data.fetchedAt).toLocaleDateString()}
          </p>
        )}

        {/* Search + category filter */}
        {!loading && data && (
          <div className="mb-6 space-y-3">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search laureates by name, motivation, country, or year…"
                className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-300"
              />
              {query && (
                <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100" title="Clear search">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {['All', ...CATEGORIES].map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    category === cat
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-4">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="h-16 bg-slate-100 rounded-2xl animate-pulse" />
            ))}
          </div>
        )}

        {/* Error + retry */}
        {error && !loading && (
          <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2 text-sm text-amber-800">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <div className="flex-1">
              <p>{error}</p>
              <button
                onClick={() => setReloadKey(k => k + 1)}
                className="mt-2 px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-xs font-medium text-amber-800 hover:bg-amber-100"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {/* Filtered matches: flat list grouped by year */}
        {!loading && !error && data && filtering && (
          <>
            <p className="text-sm text-slate-500 mb-4">
              {matchCount === 0
                ? <>No laureates match <span className="font-semibold text-slate-700">"{query}"</span>.</>
                : <><span className="font-semibold text-slate-700">{matchCount.toLocaleString()}</span> laureate{matchCount === 1 ? '' : 's'} match{matchCount === 1 ? 'es' : ''} in {filtered.length} year{filtered.length === 1 ? '' : 's'}.</>}
            </p>
            <div className="space-y-6">
              {visibleYears.map(({ year, awards }) => (
                <div key={year}>
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">{year}</div>
                  <div className="space-y-3">
                    {awards.map(award => <AwardRow key={award.category} award={award} prizeCountById={prizeCountById} />)}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Browse-all mode: collapsible year timeline */}
        {!loading && !error && data && !filtering && (
          <div className="space-y-2.5">
            {visibleYears.map(({ year, awards }) => {
              const open = openYear === year;
              const laureateCount = awards.reduce((s, a) => s + a.laureates.length, 0);
              return (
                <div key={year} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                  <button
                    onClick={() => setOpenYear(open ? null : year)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left"
                  >
                    <span className="text-lg font-bold text-slate-800 tabular-nums w-14 shrink-0">{year}</span>
                    <span className="flex flex-wrap gap-1 flex-1 min-w-0">
                      {awards.map(a => (
                        <span key={a.category} className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${CATEGORY_CHIP[a.category]}`}>
                          {a.category}
                        </span>
                      ))}
                    </span>
                    <span className="text-xs text-slate-400 shrink-0 hidden sm:block">{laureateCount} laureate{laureateCount === 1 ? '' : 's'}</span>
                    <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                  </button>
                  {open && (
                    <div className="px-4 pb-4 pt-1 space-y-3 border-t border-slate-100">
                      {awards.map(award => <AwardRow key={award.category} award={award} prizeCountById={prizeCountById} />)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination — shared by browse and filter modes */}
        {!loading && !error && data && (
          <Pager
            pagination={pagination}
            label="years"
            pageSizes={[10, 20, 40]}
            sticky
          />
        )}
      </div>
    </div>
  );
}

function AwardRow({ award, prizeCountById }: { award: NobelAward; prizeCountById: Map<string, number> }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${CATEGORY_CHIP[award.category]}`}>
          {award.category}
        </span>
      </div>
      <div className="space-y-2">
        {award.laureates.map(laureate => (
          <LaureateCard key={laureate.id} laureate={laureate} prizeCountById={prizeCountById} />
        ))}
      </div>
    </div>
  );
}

function LaureateCard({ laureate, prizeCountById }: { laureate: NobelLaureate; prizeCountById: Map<string, number> }) {
  const multi = prizeCountById.get(laureate.id) ?? 1;
  const life = laureate.birthYear
    ? ` (${laureate.birthYear}${laureate.deathYear ? `–${laureate.deathYear}` : '–'})`
    : '';
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-100 px-3.5 py-2.5">
      <div className="flex items-start gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {laureate.nobelUrl ? (
              <a
                href={laureate.nobelUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-slate-800 hover:text-amber-700 hover:underline"
                title="View on NobelPrize.org"
              >
                {laureate.name}
              </a>
            ) : (
              <span className="text-sm font-semibold text-slate-800">{laureate.name}</span>
            )}
            {multi > 1 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-yellow-500 text-white flex items-center gap-0.5" title={`Won the Nobel Prize ${multi} times`}>
                <Trophy size={9} /> {multi}× laureate
              </span>
            )}
            <span className="text-xs text-slate-400">
              {laureate.country ? `${laureate.country}` : ''}{life}
            </span>
          </div>
          {laureate.motivation && (
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">{laureate.motivation}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {laureate.portion && laureate.portion !== '1' && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600" title={`Share of the prize: ${laureate.portion}`}>
              {portionLabel(laureate.portion)}
            </span>
          )}
          {laureate.wikipedia && (
            <a
              href={laureate.wikipedia}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              title="Wikipedia"
            >
              <BookOpen size={13} />
            </a>
          )}
          {laureate.nobelUrl && (
            <a
              href={laureate.nobelUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-md text-slate-400 hover:text-amber-700 hover:bg-amber-50"
              title="NobelPrize.org facts"
            >
              <ExternalLink size={13} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/** "1/2" → "½ share", "1" → null (unshared). */
function portionLabel(portion: string): string {
  const map: Record<string, string> = { '1/2': '½ share', '1/3': '⅓ share', '1/4': '¼ share' };
  return map[portion] ?? `${portion} share`;
}
