import { useState, useMemo } from 'react';
import { Target, Plus, Edit2, RefreshCw, Loader2, Sparkles, Hash, TrendingUp, Clock } from 'lucide-react';
import { Tracker } from '../types';
import { useTracking } from '../contexts/TrackingContext';
import { usePapers } from '../contexts/PapersContext';
import { TRACKER_COLOR_CLASSES } from '../utils/trackerScoring';
import { CATEGORY_COLORS_LIGHT } from '../utils/categories';
import { format, formatDistanceToNow } from 'date-fns';
import TrackerForm from './TrackerForm';

type SortMode = 'score' | 'date';

export default function TrackingView() {
  const { trackers, scoring, rescoreTracker, matchesByTracker } = useTracking();
  const { setSelectedPaper, settings } = usePapers();
  const [activeId,    setActiveId]    = useState<string | null>(null);
  const [editing,     setEditing]     = useState<Tracker | null>(null);
  const [creating,    setCreating]    = useState(false);
  const [sortMode,    setSortMode]    = useState<SortMode>('score');

  const active = useMemo(
    () => trackers.find(t => t.id === activeId) ?? trackers[0] ?? null,
    [trackers, activeId],
  );

  const matches = useMemo(
    () => active ? matchesByTracker(active.id) : [],
    [active, matchesByTracker],
  );

  const sortedMatches = useMemo(() => {
    if (sortMode === 'date') {
      return [...matches].sort((a, b) => b.paper.digestDate.getTime() - a.paper.digestDate.getTime());
    }
    return matches; // already score-sorted by matchesByTracker
  }, [matches, sortMode]);

  // Per-tracker match count (>= minScore)
  const countByTracker = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of trackers) m.set(t.id, matchesByTracker(t.id).length);
    return m;
  }, [trackers, matchesByTracker]);

  // ----- Empty states -----
  if (trackers.length === 0) {
    return (
      <div className="h-full overflow-y-auto main-scroll bg-slate-50">
        <div className="max-w-3xl mx-auto px-8 py-16 fade-in">
          <div className="text-center">
            <div className="inline-flex w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 items-center justify-center mb-5 shadow-lg shadow-blue-500/20">
              <Target size={28} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-800 mb-2">Track research that actually matters</h1>
            <p className="text-slate-500 max-w-md mx-auto leading-relaxed">
              Describe what you care about in plain English — Claude (or local keyword scoring) will rank every new paper from your inbox against your trackers.
            </p>
            <button
              onClick={() => setCreating(true)}
              className="mt-6 inline-flex items-center gap-2 px-5 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-all shadow-sm shadow-blue-600/20"
            >
              <Plus size={16} />
              Create your first tracker
            </button>
          </div>

          {/* Example trackers */}
          <div className="mt-12 grid sm:grid-cols-2 gap-4">
            <ExampleCard
              title="Mech. interp of world models"
              desc="World-model architectures (Dreamer, PWM, etc.) with a mechanistic-interp lens — circuits, probes, ablation studies. Skip pure RL benchmarks."
              kw="world model, latent dynamics, circuits, probing, mechanistic"
            />
            <ExampleCard
              title="Sparse experts (MoE) — efficiency"
              desc="MoE routing, load balancing, expert specialisation, inference efficiency. Especially work on training stability and small-model MoE."
              kw="mixture of experts, routing, top-k, sparse, expert load"
            />
            <ExampleCard
              title="RAG beyond chunked retrieval"
              desc="Retrieval-augmented generation that goes past naive top-k chunks — graph-based, iterative, agentic retrieval, structured knowledge."
              kw="retrieval augmented, RAG, graph retrieval, iterative, agentic"
            />
            <ExampleCard
              title="Flow matching for generative models"
              desc="Continuous normalising flows, flow matching, rectified flow. Theory + applications, not just diffusion comparisons."
              kw="flow matching, rectified flow, continuous normalizing, optimal transport"
            />
          </div>
        </div>

        {creating && <TrackerForm onClose={() => setCreating(false)} />}
      </div>
    );
  }

  // ----- Main view (has trackers) -----
  return (
    <div className="h-full overflow-y-auto main-scroll bg-slate-50">
      <div className="max-w-6xl mx-auto px-8 py-8 fade-in">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-sm">
              <Target size={20} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Tracking</h1>
              <p className="text-sm text-slate-500">
                {trackers.length} tracker{trackers.length !== 1 ? 's' : ''} ·{' '}
                <span className="font-medium text-slate-600">
                  {settings.claudeApiKey ? '✨ Claude AI scoring' : 'keyword scoring (free)'}
                </span>
              </p>
            </div>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-all shadow-sm"
          >
            <Plus size={15} />
            New tracker
          </button>
        </div>

        {/* Active scoring banner */}
        {scoring && (
          <div className="mb-4 flex items-center gap-3 px-4 py-2.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-sm">
            <Loader2 size={14} className="animate-spin" />
            <span>Scoring papers ({scoring.done} / {scoring.total})</span>
            <div className="flex-1 h-1.5 bg-blue-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{ width: `${Math.round((scoring.done / Math.max(1, scoring.total)) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Tracker tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1 mb-6 hide-scrollbar">
          {trackers.map(t => {
            const cls = TRACKER_COLOR_CLASSES[t.color] ?? TRACKER_COLOR_CLASSES.blue;
            const count = countByTracker.get(t.id) ?? 0;
            const isActive = active?.id === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveId(t.id)}
                className={`shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium border transition-all ${
                  isActive
                    ? `${cls.chip} ${cls.ring} ring-2 ring-offset-1`
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${cls.dot}`} />
                <span>{t.name}</span>
                {!t.enabled && <span className="text-[10px] text-slate-400 font-normal">off</span>}
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/70' : 'bg-slate-100 text-slate-500'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {active && (
          <ActiveTrackerView
            tracker={active}
            matches={sortedMatches}
            sortMode={sortMode}
            setSortMode={setSortMode}
            onEdit={() => setEditing(active)}
            onRescore={() => rescoreTracker(active.id)}
            onOpenPaper={p => setSelectedPaper(p)}
            isScoring={scoring?.trackerId === active.id}
          />
        )}
      </div>

      {creating && <TrackerForm onClose={() => setCreating(false)} />}
      {editing && <TrackerForm tracker={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ---------- Inner: tracker detail panel ----------

function ActiveTrackerView({
  tracker, matches, sortMode, setSortMode, onEdit, onRescore, onOpenPaper, isScoring,
}: {
  tracker: Tracker;
  matches: ReturnType<ReturnType<typeof useTracking>['matchesByTracker']>;
  sortMode: SortMode;
  setSortMode: (m: SortMode) => void;
  onEdit: () => void;
  onRescore: () => void;
  onOpenPaper: (p: import('../types').Paper) => void;
  isScoring: boolean;
}) {
  const cls = TRACKER_COLOR_CLASSES[tracker.color] ?? TRACKER_COLOR_CLASSES.blue;

  return (
    <div>
      {/* Tracker header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-5 shadow-sm">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-2.5 h-2.5 rounded-full ${cls.dot}`} />
              <h2 className="text-xl font-bold text-slate-800">{tracker.name}</h2>
              {!tracker.enabled && (
                <span className="text-[10px] uppercase font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">Disabled</span>
              )}
            </div>
            {tracker.description && (
              <p className="text-sm text-slate-600 leading-relaxed">{tracker.description}</p>
            )}
            {tracker.keywords.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {tracker.keywords.map(k => (
                  <span key={k} className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${cls.chip}`}>
                    <Hash size={9} className="inline -mt-0.5 mr-0.5" />
                    {k}
                  </span>
                ))}
              </div>
            )}
            {tracker.seedArxivIds.length > 0 && (
              <p className="mt-2 text-xs text-slate-400">
                Seeded with {tracker.seedArxivIds.length} paper{tracker.seedArxivIds.length !== 1 ? 's' : ''}: <span className="font-mono">{tracker.seedArxivIds.join(', ')}</span>
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="flex items-center gap-1">
              <button
                onClick={onRescore}
                disabled={isScoring}
                title="Re-score every paper against this tracker"
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 rounded-lg border border-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <RefreshCw size={12} className={isScoring ? 'animate-spin' : ''} />
                {isScoring ? 'Scoring…' : 'Re-score'}
              </button>
              <button
                onClick={onEdit}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 rounded-lg border border-slate-200 transition-colors"
              >
                <Edit2 size={12} />
                Edit
              </button>
            </div>
            <p className="text-[11px] text-slate-400">min score · {tracker.minScore}</p>
          </div>
        </div>
      </div>

      {/* Matches header + sort */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
          <TrendingUp size={14} className="text-blue-500" />
          {matches.length} match{matches.length !== 1 ? 'es' : ''}
        </h3>
        <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
          <button
            onClick={() => setSortMode('score')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${sortMode === 'score' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
          >
            By score
          </button>
          <button
            onClick={() => setSortMode('date')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${sortMode === 'date' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
          >
            By date
          </button>
        </div>
      </div>

      {/* Matches list */}
      {matches.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-8 text-center">
          <p className="text-sm text-slate-500">
            No matches above score {tracker.minScore} yet.
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Lower the threshold, edit the description, or wait for new papers from the next sync.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {matches.map(({ paper, score }) => (
            <button
              key={paper.id}
              onClick={() => onOpenPaper(paper)}
              className="w-full text-left bg-white rounded-xl border border-slate-200 hover:border-blue-300 hover:shadow-sm transition-all p-4 group"
            >
              <div className="flex items-start gap-4">
                {/* Score badge */}
                <div className="shrink-0 flex flex-col items-center">
                  <div className={`w-14 h-14 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-sm ${cls.bar}`} style={{ opacity: 0.4 + (score.score / 100) * 0.6 }}>
                    {score.score}
                  </div>
                  <span className="text-[9px] uppercase tracking-wider text-slate-400 mt-1 font-medium">
                    {score.source === 'claude' ? <span className="flex items-center gap-0.5"><Sparkles size={8} /> AI</span> : 'keyword'}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  {/* Categories */}
                  <div className="flex flex-wrap gap-1 mb-1">
                    {paper.categories.slice(0, 3).map(cat => {
                      const color = CATEGORY_COLORS_LIGHT[cat] ?? CATEGORY_COLORS_LIGHT.default;
                      return (
                        <span key={cat} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${color}`}>
                          {cat}
                        </span>
                      );
                    })}
                  </div>
                  <p className="text-sm font-semibold text-slate-800 leading-snug group-hover:text-blue-700 transition-colors line-clamp-2">
                    {paper.title}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 truncate">
                    {paper.authorList[0]}{paper.authorList.length > 1 ? ` et al.` : ''} · {format(paper.digestDate, 'MMM d, yyyy')} · arXiv:{paper.arxivId}
                  </p>
                  {/* Rationale */}
                  <p className="text-xs text-slate-500 mt-2 italic leading-relaxed">
                    <span className="text-slate-400">why match:</span> {score.rationale}
                  </p>
                  <p className="text-[10px] text-slate-300 mt-1 flex items-center gap-1">
                    <Clock size={9} />
                    scored {formatDistanceToNow(new Date(score.ts), { addSuffix: true })}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ExampleCard({ title, desc, kw }: { title: string; desc: string; kw: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-sm font-semibold text-slate-700 mb-1">{title}</p>
      <p className="text-xs text-slate-500 leading-relaxed mb-2">{desc}</p>
      <p className="text-[10px] text-slate-400 font-mono leading-snug">
        keywords: {kw}
      </p>
    </div>
  );
}
