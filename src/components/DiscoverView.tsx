import { useState, useCallback, useEffect } from 'react';
import { Compass, Search, Telescope, Sparkles, Rocket, Star, ScrollText, Loader2, AlertCircle } from 'lucide-react';
import { s2Search, groupForDiscover, DiscoverGroups } from '../utils/semanticScholar';
import { usePapers } from '../contexts/PapersContext';
import S2PaperCard from './S2PaperCard';

const EXAMPLE_TOPICS = [
  'world models',
  'mixture of experts',
  'retrieval augmented generation',
  'diffusion models',
  'mechanistic interpretability',
  'multi-agent reinforcement learning',
  'flow matching',
  'mamba state space',
];

export default function DiscoverView() {
  const { settings } = usePapers();
  const [query, setQuery]               = useState('');
  const [activeQuery, setActiveQuery]   = useState('');
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [groups, setGroups]             = useState<DiscoverGroups | null>(null);
  const [total, setTotal]               = useState<number>(0);
  const [source, setSource]             = useState<'semantic-scholar' | 'openalex' | null>(null);

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setActiveQuery(trimmed);
    setLoading(true);
    setError(null);
    setGroups(null);
    try {
      const result = await s2Search(trimmed, { limit: 100, settings });
      setTotal(result.total ?? result.data.length);
      setSource(result.source ?? 'semantic-scholar');
      setGroups(groupForDiscover(result.data));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Search failed';
      setError(/429|rate/i.test(msg)
        ? 'Semantic Scholar is rate-limiting us — try again in a few seconds (or add an API key in Settings to raise the limit).'
        : msg);
    } finally {
      setLoading(false);
    }
  }, [settings]);

  // Run a search whenever the active query changes (initial empty state has no auto-search)
  useEffect(() => {
    if (activeQuery) runSearch(activeQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasResults = !!groups && (
    groups.foundational.length + groups.influential.length + groups.latest.length + groups.surveys.length > 0
  );

  return (
    <div className="h-full overflow-y-auto main-scroll">
      <div className="max-w-6xl mx-auto px-8 py-8 fade-in">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white shadow-sm">
            <Compass size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Discover</h1>
            <p className="text-sm text-slate-500">Search any research topic and get a ranked starting curriculum.</p>
          </div>
        </div>

        {/* Search box */}
        <form
          onSubmit={e => { e.preventDefault(); runSearch(query); }}
          className="mt-6"
        >
          <div className="relative">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Try: world models, diffusion transformers, RAG, mechanistic interpretability…"
              className="w-full pl-11 pr-32 py-4 bg-white border border-slate-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-all"
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Telescope size={14} />}
              {loading ? 'Searching…' : 'Discover'}
            </button>
          </div>
        </form>

        {/* Example topics */}
        {!activeQuery && (
          <>
            <p className="mt-6 text-xs uppercase font-semibold tracking-wider text-slate-400">Try a topic</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {EXAMPLE_TOPICS.map(t => (
                <button
                  key={t}
                  onClick={() => { setQuery(t); runSearch(t); }}
                  className="px-3.5 py-1.5 rounded-full bg-white border border-slate-200 text-sm text-slate-600 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 transition-all"
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Empty state explainer */}
            <div className="mt-12 grid sm:grid-cols-2 gap-4 max-w-3xl">
              <ExplainerCard
                icon={<Star size={16} className="text-amber-500" />}
                title="Foundational"
                text="The most cited papers on the topic from at least 4 years ago — the canon."
              />
              <ExplainerCard
                icon={<Rocket size={16} className="text-rose-500" />}
                title="Influential recent"
                text="Highly-cited work from the last three years — what's actively shaping the field now."
              />
              <ExplainerCard
                icon={<Sparkles size={16} className="text-emerald-500" />}
                title="Latest publications"
                text="What just dropped, regardless of citation count — for tracking the frontier."
              />
              <ExplainerCard
                icon={<ScrollText size={16} className="text-indigo-500" />}
                title="Surveys & reviews"
                text="Synthesis papers and surveys — the best places to get oriented if you're new."
              />
            </div>
          </>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="mt-10 space-y-6">
            {[0, 1].map(i => (
              <div key={i}>
                <div className="h-4 w-40 bg-slate-200 rounded mb-3 animate-pulse" />
                <div className="grid lg:grid-cols-2 gap-3">
                  {[0, 1, 2, 3].map(j => (
                    <div key={j} className="h-32 bg-slate-100 rounded-xl animate-pulse" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2 text-sm text-amber-800">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Results */}
        {!loading && hasResults && groups && (
          <div className="mt-10">
            <p className="text-sm text-slate-500 mb-6 flex flex-wrap items-center gap-2">
              <span>
                Found <span className="font-semibold text-slate-700">{total.toLocaleString()}</span> papers on{' '}
                <span className="font-semibold text-slate-700">"{activeQuery}"</span>. Showing the highest-signal results.
              </span>
              {source === 'openalex' && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700" title="Semantic Scholar rate-limited the request — results from OpenAlex (which doesn't have TLDRs).">
                  via OpenAlex (S2 rate-limited)
                </span>
              )}
            </p>

            {groups.foundational.length > 0 && (
              <GroupSection
                title="Foundational"
                subtitle="Highly-cited classics on this topic"
                icon={<Star size={16} className="text-amber-500" />}
                color="from-amber-50 to-transparent"
                papers={groups.foundational}
                highlight="foundational"
              />
            )}

            {groups.surveys.length > 0 && (
              <GroupSection
                title="Surveys & reviews"
                subtitle="Best entry points if you're new to the field"
                icon={<ScrollText size={16} className="text-indigo-500" />}
                color="from-indigo-50 to-transparent"
                papers={groups.surveys}
                highlight="survey"
              />
            )}

            {groups.influential.length > 0 && (
              <GroupSection
                title="Influential recent work"
                subtitle="Highly-cited papers from the last few years"
                icon={<Rocket size={16} className="text-rose-500" />}
                color="from-rose-50 to-transparent"
                papers={groups.influential}
                highlight="influential"
              />
            )}

            {groups.latest.length > 0 && (
              <GroupSection
                title="Latest publications"
                subtitle="What just dropped — for tracking the frontier"
                icon={<Sparkles size={16} className="text-emerald-500" />}
                color="from-emerald-50 to-transparent"
                papers={groups.latest}
                highlight="latest"
              />
            )}
          </div>
        )}

        {!loading && activeQuery && !hasResults && !error && (
          <div className="mt-10 text-center text-slate-500 text-sm">
            No results found. Try a broader or different phrasing.
          </div>
        )}
      </div>
    </div>
  );
}

function GroupSection({
  title, subtitle, icon, color, papers, highlight,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  color: string;
  papers: import('../types').S2Paper[];
  highlight: 'foundational' | 'influential' | 'latest' | 'survey';
}) {
  return (
    <section className={`mb-10 rounded-2xl bg-gradient-to-b ${color} p-5 -mx-2`}>
      <div className="flex items-center gap-2 mb-1 px-1">
        {icon}
        <h2 className="text-base font-semibold text-slate-800">{title}</h2>
      </div>
      <p className="text-xs text-slate-500 mb-4 px-1">{subtitle}</p>
      <div className="grid lg:grid-cols-2 gap-3">
        {papers.map(p => <S2PaperCard key={p.paperId} paper={p} highlight={highlight} />)}
      </div>
    </section>
  );
}

function ExplainerCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <p className="text-sm font-semibold text-slate-700">{title}</p>
      </div>
      <p className="text-xs text-slate-500 leading-relaxed">{text}</p>
    </div>
  );
}
