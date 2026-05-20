import { useMemo } from 'react';
import { Sigma, Quote, Tag, Users } from 'lucide-react';
import { Paper } from '../types';
import { usePapers } from '../contexts/PapersContext';
import { useLibrary } from '../contexts/LibraryContext';
import { SimilarityIndex, SimilarityResult } from '../utils/textSimilarity';

interface Props {
  paper: Paper;
}

/**
 * Replaces the previous AI-driven correlations panel with a pure
 * client-side TF-IDF similarity index. No tokens, no network — just
 * cosine similarity over the user's own library + inbox, blended with
 * category and author overlap.
 *
 * The index is built once per render against the current paper set and
 * cached via useMemo keyed on the paper-set signature, so opening
 * different papers in sequence reuses the same index.
 */
export default function SimilarPapersPanel({ paper }: Props) {
  const { papers, setSelectedPaper } = usePapers();
  const { savedPapers } = useLibrary();

  // Build a single index from library ∪ inbox so saved papers always
  // get a chance to match even when they aren't in the recent inbox.
  const corpus: Paper[] = useMemo(() => {
    const seen = new Set<string>();
    const out: Paper[] = [];
    for (const p of [...savedPapers, ...papers]) {
      if (!p.arxivId || seen.has(p.arxivId)) continue;
      seen.add(p.arxivId);
      out.push(p);
    }
    // The source paper itself must be in the corpus — otherwise the
    // index can't compute the similarities we want.
    if (paper.arxivId && !seen.has(paper.arxivId)) out.push(paper);
    return out;
  }, [savedPapers, papers, paper]);

  const index = useMemo(() => new SimilarityIndex(corpus), [corpus]);

  const results: SimilarityResult[] = useMemo(
    () => index.similar(paper.arxivId, 12, 0.05),
    [index, paper.arxivId],
  );

  return (
    <section className="mt-8 mb-10">
      <div className="flex items-center gap-2 mb-3">
        <Sigma size={15} className="text-indigo-500" />
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Similar papers in your library</h2>
        <span className="text-[10px] text-slate-400 ml-1">local · TF-IDF + category + author</span>
        <span className="ml-auto text-[10px] text-slate-400">{corpus.length.toLocaleString()} papers indexed</span>
      </div>

      {results.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/50 px-4 py-4 text-sm text-slate-500">
          {corpus.length < 3
            ? 'Sync your inbox or bookmark a few papers — the index needs a corpus to compare against.'
            : 'No similar papers found in your library — this one looks like an outlier.'}
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-2.5">
          {results.map(r => (
            <SimilarRow
              key={r.paper.arxivId}
              result={r}
              onOpen={() => setSelectedPaper(r.paper)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function SimilarRow({ result, onOpen }: { result: SimilarityResult; onOpen: () => void }) {
  const { paper, scorePct, signals } = result;
  return (
    <button
      onClick={onOpen}
      className="group flex items-start gap-3 bg-white border border-slate-200 rounded-xl p-3.5 hover:border-indigo-300 hover:shadow-sm transition-all text-left"
    >
      <div
        className="shrink-0 w-12 h-12 rounded-lg bg-indigo-500 text-white text-base font-bold flex items-center justify-center shadow-sm"
        style={{ opacity: 0.45 + (scorePct / 100) * 0.55 }}
      >
        {scorePct}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 line-clamp-2 leading-snug group-hover:text-indigo-700 transition-colors">{paper.title}</p>
        <p className="text-xs text-slate-500 mt-0.5 truncate">
          <Quote size={9} className="inline -mt-0.5 mr-0.5 text-slate-400" />
          {paper.authorList[0] ?? '—'}{paper.authorList.length > 1 ? ' et al.' : ''} · arXiv:{paper.arxivId}
        </p>
        {/* Signal breakdown — useful for troubleshooting */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <SignalChip icon={<Sigma size={9} />}  label="text"  pct={signals.text} tone="indigo" />
          {signals.categories > 0 && <SignalChip icon={<Tag size={9} />}    label="cats"  pct={signals.categories} tone="emerald" />}
          {signals.authors    > 0 && <SignalChip icon={<Users size={9} />} label="auth"  pct={signals.authors}    tone="amber" />}
        </div>
      </div>
    </button>
  );
}

function SignalChip({ icon, label, pct, tone }: { icon: React.ReactNode; label: string; pct: number; tone: 'indigo' | 'emerald' | 'amber' }) {
  const toneCls = {
    indigo:  'bg-indigo-50 text-indigo-700 border-indigo-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    amber:   'bg-amber-50 text-amber-700 border-amber-100',
  }[tone];
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border flex items-center gap-1 ${toneCls}`}>
      {icon}
      {label} {Math.round(pct * 100)}%
    </span>
  );
}
