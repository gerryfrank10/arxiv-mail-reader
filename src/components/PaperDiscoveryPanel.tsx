import { useCallback, useEffect, useState } from 'react';
import { GitFork, ArrowDownLeft, ArrowUpRight, Sparkles, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { Paper, S2Paper } from '../types';
import {
  s2References, s2Citations, s2Recommendations,
  S2ReferenceRow, S2CitationRow,
} from '../utils/semanticScholar';
import { usePapers } from '../contexts/PapersContext';
import S2PaperCard from './S2PaperCard';

interface Props {
  paper: Paper;
}

type Tab = 'references' | 'citations' | 'similar';

const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode; tone: string }> = [
  { id: 'references', label: 'References',  icon: <ArrowDownLeft size={14} />, tone: 'sky' },
  { id: 'citations',  label: 'Cited by',    icon: <ArrowUpRight size={14} />,  tone: 'rose' },
  { id: 'similar',    label: 'Similar work', icon: <Sparkles size={14} />,     tone: 'violet' },
];

export default function PaperDiscoveryPanel({ paper }: Props) {
  const { settings } = usePapers();
  const [tab,         setTab]         = useState<Tab>('references');
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [references,  setReferences]  = useState<S2ReferenceRow[] | null>(null);
  const [citations,   setCitations]   = useState<S2CitationRow[] | null>(null);
  const [similar,     setSimilar]     = useState<S2Paper[] | null>(null);
  const [retryNonce,  setRetryNonce]  = useState(0);

  const load = useCallback(async (which: Tab, ctrl: AbortController) => {
    setLoading(true);
    setError(null);
    try {
      if (which === 'references') {
        const r = await s2References(paper.arxivId, { limit: 40, signal: ctrl.signal, settings });
        setReferences(r.data ?? []);
      } else if (which === 'citations') {
        const r = await s2Citations(paper.arxivId, { limit: 40, signal: ctrl.signal, settings });
        setCitations(r.data ?? []);
      } else {
        const r = await s2Recommendations(paper.arxivId, { limit: 20, signal: ctrl.signal, settings });
        setSimilar(r.recommendedPapers ?? []);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      const msg = e instanceof Error ? e.message : 'Request failed';
      setError(/429|rate/i.test(msg)
        ? 'Semantic Scholar is rate-limiting us. Add an API key in Settings or try again shortly.'
        : msg);
    } finally {
      setLoading(false);
    }
  }, [paper.arxivId, settings]);

  // Load whenever paper / tab / retry changes
  useEffect(() => {
    const ctrl = new AbortController();
    // Only fetch if we don't already have data for this tab
    const have = tab === 'references' ? references : tab === 'citations' ? citations : similar;
    if (have == null || retryNonce > 0) load(tab, ctrl);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, paper.arxivId, retryNonce]);

  // Reset all caches when the paper changes
  useEffect(() => {
    setReferences(null);
    setCitations(null);
    setSimilar(null);
    setError(null);
    setRetryNonce(0);
  }, [paper.arxivId]);

  const papersToShow: S2Paper[] =
    tab === 'references' ? (references ?? []).map(r => withInfluence(r.citedPaper, r.isInfluential))
    : tab === 'citations' ? (citations  ?? []).map(c => withInfluence(c.citingPaper, c.isInfluential))
    : (similar ?? []);

  return (
    <div className="mt-8 mb-10">
      <div className="flex items-center gap-2 mb-4">
        <GitFork size={15} className="text-slate-500" />
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Explore citation graph</h2>
        <span className="text-[10px] text-slate-400 ml-1">via Semantic Scholar</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 mb-5 w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-sm font-medium transition-all ${
              tab === t.id
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.icon}
            {t.label}
            {tab === t.id && papersToShow.length > 0 && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {papersToShow.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-6">
          <Loader2 size={14} className="animate-spin" />
          Loading {tab === 'references' ? 'references' : tab === 'citations' ? 'citing papers' : 'similar work'} from Semantic Scholar…
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3 text-sm text-amber-800">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button
            onClick={() => setRetryNonce(n => n + 1)}
            className="px-3 py-1 text-xs font-medium bg-white border border-amber-300 text-amber-700 rounded-md hover:bg-amber-100 transition-colors flex items-center gap-1"
          >
            <RefreshCw size={11} />
            Retry
          </button>
        </div>
      )}

      {/* Results */}
      {!loading && !error && papersToShow.length === 0 && (
        <p className="text-sm text-slate-400 italic py-6">
          {tab === 'references' && 'No reference data available for this paper.'}
          {tab === 'citations'  && 'No papers have cited this one yet.'}
          {tab === 'similar'    && 'No similar-work suggestions available.'}
        </p>
      )}

      {!loading && !error && papersToShow.length > 0 && (
        <div className="grid lg:grid-cols-2 gap-3">
          {papersToShow.map(p => (
            <S2PaperCard
              key={p.paperId || `${p.title}-${p.year}`}
              paper={p}
              compact
              highlight={p.influentialCitationCount && p.influentialCitationCount > 0 ? 'influential' : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Tag the paper with influence flag so the card highlights it
function withInfluence(p: S2Paper, influential?: boolean): S2Paper {
  if (!influential || !p) return p;
  return { ...p, influentialCitationCount: Math.max(p.influentialCitationCount ?? 0, 1) };
}
