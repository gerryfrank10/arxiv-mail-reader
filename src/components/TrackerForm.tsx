import { useEffect, useState } from 'react';
import { X, Target, Hash, Sparkles, FileText, Trash2 } from 'lucide-react';
import { Tracker } from '../types';
import { TRACKER_COLORS, TRACKER_COLOR_CLASSES } from '../utils/trackerScoring';
import { useTracking } from '../contexts/TrackingContext';
import { usePapers } from '../contexts/PapersContext';

interface Props {
  tracker?: Tracker;       // undefined → create mode
  onClose: () => void;
}

export default function TrackerForm({ tracker, onClose }: Props) {
  const { createTracker, updateTracker, deleteTracker } = useTracking();
  const { settings, papers } = usePapers();
  const editing = !!tracker;

  const [name,        setName]        = useState(tracker?.name ?? '');
  const [description, setDescription] = useState(tracker?.description ?? '');
  const [keywords,    setKeywords]    = useState((tracker?.keywords ?? []).join(', '));
  const [seeds,       setSeeds]       = useState((tracker?.seedArxivIds ?? []).join(', '));
  const [color,       setColor]       = useState(tracker?.color ?? 'blue');
  const [minScore,    setMinScore]    = useState(tracker?.minScore ?? 60);
  const [enabled,     setEnabled]     = useState(tracker?.enabled ?? true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function parseList(s: string): string[] {
    return s.split(/[,\n]/).map(t => t.trim()).filter(Boolean);
  }

  async function handleSave() {
    if (!name.trim()) return;
    const payload = {
      name: name.trim(),
      description: description.trim(),
      keywords:     parseList(keywords),
      seedArxivIds: parseList(seeds),
      enabled,
      color,
      minScore,
    };
    if (editing) await updateTracker(tracker!.id, payload);
    else         await createTracker(payload);
    onClose();
  }

  async function handleDelete() {
    if (!tracker) return;
    await deleteTracker(tracker.id);
    onClose();
  }

  const usingClaude = !!settings.claudeApiKey;
  const colorCls    = TRACKER_COLOR_CLASSES[color] ?? TRACKER_COLOR_CLASSES.blue;

  // Inbox titles for the seed picker
  const inboxArxivIds = papers.slice(0, 50).map(p => p.arxivId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto fade-in">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <Target size={18} className="text-blue-500" />
            {editing ? 'Edit tracker' : 'New tracker'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Scoring mode banner */}
        <div className={`mb-5 px-4 py-2.5 rounded-lg border text-xs ${
          usingClaude
            ? 'bg-violet-50 border-violet-200 text-violet-700'
            : 'bg-amber-50 border-amber-200 text-amber-800'
        }`}>
          {usingClaude ? (
            <span className="flex items-center gap-2">
              <Sparkles size={13} className="text-violet-500" />
              <strong>Claude AI scoring</strong> · uses your Claude API key from Settings.
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Hash size={13} />
              <strong>Keyword + similarity scoring</strong> · add a Claude API key in Settings for AI-driven scoring.
            </span>
          )}
        </div>

        <div className="space-y-5">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder='e.g. "Mechanistic interp of world models"'
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all"
              autoFocus
            />
          </div>

          {/* Description (long) */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              What specifically are you tracking?
              <span className="text-xs text-slate-400 font-normal ml-1">(this is the AI's main signal)</span>
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={5}
              placeholder="Be specific. e.g. 'World models for embodied agents — focus on architectures that learn predictive latent dynamics from raw observations. Especially interested in mechanistic interpretability of these models (circuits-level work, probing studies). NOT interested in pure RL benchmark papers, model-free methods, or LLM agent work unless it explicitly studies an internal world model.'"
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all"
            />
            <p className="mt-1 text-xs text-slate-400">
              {usingClaude
                ? 'Claude reads this paragraph to score each new paper from 0-100.'
                : 'Without a Claude key, scoring uses keywords + seed papers below. Add detail for when you upgrade.'}
            </p>
          </div>

          {/* Keywords */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1.5">
              <Hash size={13} className="text-slate-400" />
              Keywords <span className="text-xs text-slate-400 font-normal">(comma-separated)</span>
            </label>
            <input
              type="text"
              value={keywords}
              onChange={e => setKeywords(e.target.value)}
              placeholder="world model, latent dynamics, predictive, mechanistic interpretability"
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all"
            />
          </div>

          {/* Seed papers */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1.5">
              <FileText size={13} className="text-slate-400" />
              Seed arXiv IDs <span className="text-xs text-slate-400 font-normal">(optional — anchor papers)</span>
            </label>
            <input
              type="text"
              value={seeds}
              onChange={e => setSeeds(e.target.value)}
              placeholder="1803.10122, 2010.02193"
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all"
            />
            {inboxArxivIds.length > 0 && !editing && (
              <p className="mt-1.5 text-xs text-slate-400">
                Or paste IDs from your inbox — e.g. <button className="text-blue-500 hover:underline font-mono" onClick={() => setSeeds(inboxArxivIds.slice(0, 3).join(', '))}>{inboxArxivIds[0]}…</button>
              </p>
            )}
          </div>

          {/* Color + threshold */}
          <div className="grid grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Color</label>
              <div className="flex gap-2">
                {TRACKER_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    title={c}
                    className={`w-7 h-7 rounded-full ${TRACKER_COLOR_CLASSES[c].dot} transition-all ${color === c ? `ring-2 ring-offset-2 ${TRACKER_COLOR_CLASSES[c].ring}` : 'opacity-60 hover:opacity-100'}`}
                  />
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Min score: <span className={`font-bold ${colorCls.chip.includes('blue') ? 'text-blue-600' : ''}`}>{minScore}</span>
              </label>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={minScore}
                onChange={e => setMinScore(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
              <p className="mt-0.5 text-xs text-slate-400">Only show matches above this score.</p>
            </div>
          </div>

          {/* Enabled */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => setEnabled(e.target.checked)}
              className="w-4 h-4 accent-blue-500"
            />
            <span className="text-sm text-slate-700">Enabled <span className="text-xs text-slate-400">(auto-score new papers from sync)</span></span>
          </label>
        </div>

        <div className="mt-7 flex items-center gap-3">
          {editing && (
            <button
              onClick={() => confirmDelete ? handleDelete() : setConfirmDelete(true)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg transition-colors ${
                confirmDelete
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'text-red-600 hover:bg-red-50'
              }`}
            >
              <Trash2 size={13} />
              {confirmDelete ? 'Click again to confirm' : 'Delete'}
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="px-5 py-2.5 bg-blue-600 rounded-lg text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Target size={14} />
            {editing ? 'Save changes' : 'Create tracker'}
          </button>
        </div>
      </div>
    </div>
  );
}
