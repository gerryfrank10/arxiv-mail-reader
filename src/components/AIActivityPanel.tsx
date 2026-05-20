import { useMemo } from 'react';
import { Activity, X, Pause, Play, Trash2, CheckCircle2, AlertCircle, Loader2, XCircle, Sparkles } from 'lucide-react';
import { AIActivityRecord, AIActivityStatus, useAIActivity } from '../contexts/AIActivityContext';
import { useTracking } from '../contexts/TrackingContext';
import { providerLabel } from '../utils/aiProvider';
import { usePapers } from '../contexts/PapersContext';
import { resolveAIConfig } from '../utils/aiProvider';
import { formatDistanceToNow } from 'date-fns';

interface Props { onClose: () => void }

const PURPOSE_LABEL: Record<string, string> = {
  'tracker-score':       'Tracker scoring',
  'magazine-editorial':  'Magazine editorial',
  'paper-summary':       'Paper summary',
  'ai-suggest':          'AI Suggest',
  'writer-cite-suggest': 'Writer citation suggest',
  'connection-test':     'Connection test',
  'chat':                'Generic chat',
};

const STATUS_STYLE: Record<AIActivityStatus, { label: string; classes: string; icon: React.ReactNode }> = {
  pending:   { label: 'in flight', classes: 'bg-blue-50 text-blue-700 border-blue-200',     icon: <Loader2 size={11} className="animate-spin" /> },
  success:   { label: 'success',   classes: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: <CheckCircle2 size={11} /> },
  error:     { label: 'error',     classes: 'bg-red-50 text-red-700 border-red-200',         icon: <AlertCircle size={11} /> },
  cancelled: { label: 'cancelled', classes: 'bg-amber-50 text-amber-700 border-amber-200',   icon: <XCircle size={11} /> },
};

export default function AIActivityPanel({ onClose }: Props) {
  const { records, paused, setPaused, clear, inFlight } = useAIActivity();
  const { scoring } = useTracking();
  const { settings } = usePapers();

  const aiLabel = providerLabel(resolveAIConfig(settings));

  // Quick stats from the records buffer
  const stats = useMemo(() => {
    const last60min = records.filter(r => Date.now() - r.startedAt < 60 * 60 * 1000);
    const success   = last60min.filter(r => r.status === 'success').length;
    const errors    = last60min.filter(r => r.status === 'error').length;
    const cancelled = last60min.filter(r => r.status === 'cancelled').length;
    const totalMs   = last60min
      .filter(r => r.endedAt)
      .reduce((acc, r) => acc + ((r.endedAt ?? r.startedAt) - r.startedAt), 0);
    return { last60min: last60min.length, success, errors, cancelled, totalMs };
  }, [records]);

  return (
    <div className="fixed inset-0 z-[55] flex items-stretch justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <aside
        onClick={e => e.stopPropagation()}
        className="relative w-[480px] max-w-[95vw] bg-white shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center text-white">
            <Activity size={15} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
              AI Activity
              {inFlight > 0 && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 flex items-center gap-1">
                  <Loader2 size={9} className="animate-spin" /> {inFlight} in flight
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-500">{aiLabel} · {records.length} recent call{records.length !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500">
            <X size={16} />
          </button>
        </div>

        {/* Master pause + workers */}
        <div className="px-5 py-4 border-b border-slate-200 space-y-3 bg-slate-50">
          <button
            onClick={() => setPaused(!paused)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border transition-all ${
              paused
                ? 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100'
                : 'bg-white border-slate-200 hover:bg-slate-50'
            }`}
          >
            {paused ? <Play size={15} className="text-amber-600" /> : <Pause size={15} className="text-slate-500" />}
            <div className="flex-1 text-left">
              <p className="text-sm font-semibold">
                {paused ? 'Resume background AI' : 'Pause background AI'}
              </p>
              <p className="text-xs text-slate-500">
                {paused
                  ? 'Tracker auto-scoring + correlations worker are halted. Manual actions still work.'
                  : 'Tracker auto-scoring + correlations worker run normally.'}
              </p>
            </div>
          </button>

          <WorkerCard
            label="Tracker scoring"
            busy={!!scoring}
            detail={scoring ? `${scoring.done} / ${scoring.total}` : 'idle'}
          />

          <div className="grid grid-cols-4 gap-2 text-center">
            <StatPill label="last 60m" value={stats.last60min} />
            <StatPill label="ok"       value={stats.success}    tone="emerald" />
            <StatPill label="errors"   value={stats.errors}     tone={stats.errors > 0 ? 'red' : 'slate'} />
            <StatPill label="cancelled" value={stats.cancelled} tone="amber" />
          </div>
        </div>

        {/* Records */}
        <div className="flex items-center justify-between px-5 py-2 border-b border-slate-100 bg-white">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Recent calls</p>
          {records.length > 0 && (
            <button onClick={clear} className="text-[11px] text-slate-500 hover:text-red-600 flex items-center gap-1">
              <Trash2 size={10} /> clear
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {records.length === 0 && (
            <div className="px-5 py-10 text-center text-sm text-slate-400">
              <Sparkles size={20} className="mx-auto text-slate-300 mb-2" />
              No AI calls yet this session.
            </div>
          )}
          {records.map(r => <RecordRow key={r.id} r={r} />)}
        </div>
      </aside>
    </div>
  );
}

function RecordRow({ r }: { r: AIActivityRecord }) {
  const style = STATUS_STYLE[r.status];
  const elapsed = r.endedAt
    ? `${((r.endedAt - r.startedAt) / 1000).toFixed(1)}s`
    : `${((Date.now() - r.startedAt) / 1000).toFixed(1)}s…`;

  return (
    <div className="px-5 py-3 border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border flex items-center gap-1 ${style.classes}`}>
          {style.icon}
          {style.label}
        </span>
        <p className="text-sm font-medium text-slate-800">
          {PURPOSE_LABEL[r.purpose] ?? r.purpose}
        </p>
        <span className="ml-auto text-[11px] text-slate-400 font-mono">{elapsed}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
        {r.profile && r.profile !== 'legacy' && r.profile !== 'none' && (
          <span className={`text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border ${
            r.profile === 'premium'
              ? 'bg-violet-50 text-violet-700 border-violet-200'
              : 'bg-emerald-50 text-emerald-700 border-emerald-200'
          }`}>{r.profile}</span>
        )}
        <span>
          <span className="font-medium text-slate-600">{r.provider}</span>
          {r.model && <> · <span className="font-mono">{r.model}</span></>}
        </span>
        {r.promptChars != null && (
          <span>prompt: {humanCount(r.promptChars)} ch</span>
        )}
        {r.responseChars != null && (
          <span>reply: {humanCount(r.responseChars)} ch</span>
        )}
        <span className="ml-auto">{formatDistanceToNow(new Date(r.startedAt), { addSuffix: true })}</span>
      </div>
      {r.status === 'error' && r.error && (
        <p className="mt-1.5 text-[11px] text-red-700 bg-red-50 border border-red-100 rounded px-2 py-1 leading-relaxed">
          {r.error}
        </p>
      )}
      {r.status === 'cancelled' && (
        <p className="mt-1 text-[10px] text-amber-700 italic">
          {r.error
            ? `aborted: ${r.error}`
            : 'aborted by client (timeout or navigation) — usually harmless'}
        </p>
      )}
    </div>
  );
}

function WorkerCard({ label, busy, detail, error }: { label: string; busy: boolean; detail: string; error?: string }) {
  return (
    <div className={`rounded-lg border p-2.5 ${busy ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-200'}`}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className={`w-1.5 h-1.5 rounded-full ${busy ? 'bg-blue-500 animate-pulse' : 'bg-slate-300'}`} />
        <p className="text-[11px] font-semibold text-slate-700">{label}</p>
      </div>
      <p className={`text-[11px] font-mono ${busy ? 'text-blue-700' : 'text-slate-500'}`}>{detail}</p>
      {error && (
        <p className="text-[10px] text-red-600 mt-1 line-clamp-2" title={error}>{error}</p>
      )}
    </div>
  );
}

function StatPill({ label, value, tone = 'slate' }: { label: string; value: number; tone?: 'slate' | 'emerald' | 'red' | 'amber' }) {
  const toneCls = {
    slate:   'bg-white text-slate-700 border-slate-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    red:     'bg-red-50 text-red-700 border-red-200',
    amber:   'bg-amber-50 text-amber-700 border-amber-200',
  }[tone];
  return (
    <div className={`rounded-md border px-2 py-1.5 ${toneCls}`}>
      <p className="text-base font-bold leading-none">{value}</p>
      <p className="text-[9px] uppercase tracking-wider mt-0.5 opacity-80">{label}</p>
    </div>
  );
}

function humanCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + 'k';
  return String(n);
}
