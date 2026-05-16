import { useCallback, useEffect, useState } from 'react';
import { Brain, Quote, Loader2, RefreshCw, AlertCircle, Sparkles } from 'lucide-react';
import { Paper, PaperCorrelation } from '../types';
import { useCorrelations } from '../contexts/CorrelationsContext';
import { usePapers } from '../contexts/PapersContext';
import { useLibrary } from '../contexts/LibraryContext';
import { hasAI, providerLabel, resolveAIConfig } from '../utils/aiProvider';
import { formatDistanceToNow } from 'date-fns';

interface Props {
  paper: Paper;
}

export default function AICorrelationsPanel({ paper }: Props) {
  const { dbEnabled, getForPaper, scorePaperNow, workerBusy } = useCorrelations();
  const { papers, settings, setSelectedPaper } = usePapers();
  const { savedPapers } = useLibrary();
  const [rows, setRows]         = useState<PaperCorrelation[] | null>(null);
  const [loading, setLoading]   = useState(false);
  const [computing, setComputing] = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!dbEnabled) return;
    setLoading(true);
    setError(null);
    try { setRows(await getForPaper(paper.arxivId)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [dbEnabled, getForPaper, paper.arxivId]);

  useEffect(() => { load(); }, [load]);

  async function handleComputeNow() {
    setComputing(true);
    setError(null);
    const r = await scorePaperNow(paper);
    setComputing(false);
    if (r.error) setError(r.error);
    else         load();
  }

  // Resolve target arxivId → full Paper from the inbox/library so the row is clickable
  const allPapersByArxiv = (() => {
    const m = new Map<string, Paper>();
    for (const p of [...savedPapers, ...papers]) m.set(p.arxivId, p);
    return m;
  })();

  if (!dbEnabled) return null;

  const aiOn   = hasAI(settings);
  const aiName = providerLabel(resolveAIConfig(settings));
  const hasRows = (rows ?? []).length > 0;

  return (
    <section className="mt-8 mb-10">
      <div className="flex items-center gap-2 mb-3">
        <Brain size={15} className="text-fuchsia-500" />
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">AI correlations</h2>
        <span className="text-[10px] text-slate-400 ml-1">cached · {aiName}</span>
        <button
          onClick={handleComputeNow}
          disabled={computing || !aiOn || workerBusy}
          title={!aiOn ? 'Configure an AI provider first' : hasRows ? 'Re-score against your library' : 'Compute correlations for this paper now'}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium border rounded-md transition-all disabled:opacity-40 disabled:cursor-not-allowed border-fuchsia-200 text-fuchsia-700 hover:bg-fuchsia-50"
        >
          {computing ? <Loader2 size={11} className="animate-spin" /> : (hasRows ? <RefreshCw size={11} /> : <Sparkles size={11} />)}
          {computing ? 'scoring…' : hasRows ? 're-score' : 'compute now'}
        </button>
      </div>

      {loading && (
        <div className="text-sm text-slate-400 italic flex items-center gap-2">
          <Loader2 size={12} className="animate-spin" /> loading correlations…
        </div>
      )}

      {error && !loading && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 flex items-start gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && !hasRows && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/50 px-4 py-4 text-sm text-slate-500">
          No AI correlations cached for this paper yet.
          {aiOn ? (
            <span> Click <span className="font-medium">"compute now"</span> to score it against your library, or enable the background worker in Settings to do this automatically (rate-limited to 100 papers/hour).</span>
          ) : (
            <span> Configure an AI provider in Settings first.</span>
          )}
        </div>
      )}

      {!loading && hasRows && (
        <div className="grid lg:grid-cols-2 gap-2.5">
          {(rows ?? []).map(r => {
            const target = allPapersByArxiv.get(r.targetArxivId);
            return (
              <button
                key={r.targetArxivId}
                onClick={() => { if (target) setSelectedPaper(target); }}
                disabled={!target}
                className="group flex items-start gap-3 bg-white border border-slate-200 rounded-xl p-3.5 hover:border-fuchsia-300 hover:shadow-sm transition-all text-left disabled:opacity-60"
              >
                <div
                  className="shrink-0 w-12 h-12 rounded-lg bg-fuchsia-500 text-white text-lg font-bold flex items-center justify-center shadow-sm"
                  style={{ opacity: 0.45 + (r.score / 100) * 0.55 }}
                >
                  {r.score}
                </div>
                <div className="flex-1 min-w-0">
                  {target ? (
                    <>
                      <p className="text-sm font-semibold text-slate-800 line-clamp-2 leading-snug group-hover:text-fuchsia-700 transition-colors">{target.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">
                        {target.authorList[0] ?? '—'} · arXiv:{target.arxivId}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                        <Quote size={11} className="text-slate-400" />
                        arXiv:{r.targetArxivId}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">(not in your local inbox/library)</p>
                    </>
                  )}
                  {r.rationale && (
                    <p className="text-xs text-slate-600 mt-1.5 italic leading-relaxed line-clamp-2">"{r.rationale}"</p>
                  )}
                  <p className="text-[10px] text-slate-300 mt-1">computed {formatDistanceToNow(new Date(r.computedAt), { addSuffix: true })}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
