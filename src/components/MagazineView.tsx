import { memo, useEffect, useMemo, useState } from 'react';
import { Newspaper, Sparkles, Loader2, AlertCircle, Trash2, ExternalLink, Star, GitBranch, Cpu, MessageSquare, ArrowRight, Calendar, BookOpen, Clock, Check } from 'lucide-react';
import { useMagazine } from '../contexts/MagazineContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { usePapers } from '../contexts/PapersContext';
import { hasAI, providerLabel, resolveAIConfig } from '../utils/aiProvider';
import { computeAssessment, ASSESSMENT_BADGE } from '../utils/assessment';
import { CATEGORY_COLORS_LIGHT } from '../utils/categories';
import { MagazineGitHubItem, MagazineHFItem, MagazineHNItem, MagazineMSItem, MagazineNewsItem, MagazineSource, Paper } from '../types';
import { format, formatDistanceToNow } from 'date-fns';
import { apiGetMagazineAutoPrefs, apiSetMagazineAutoPrefs, MagazineAutoPrefs } from '../utils/researchApi';

const SOURCE_LABEL: Record<MagazineSource, string> = {
  hackernews:  'Hacker News',
  news:        'AI News',
  huggingface: 'HuggingFace',
  github:      'GitHub',
  modelscope:  'ModelScope',
};

export default function MagazineView() {
  const { issues, active, dbEnabled, generating, error, editorialError, editorialBusy, generateThisWeek, generateEditorialFor, refresh, removeIssue } = useMagazine();
  const { settings, setSelectedPaper } = usePapers();
  const confirm = useConfirm();
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!dbEnabled) {
    return (
      <div className="h-full flex items-center justify-center px-8 bg-slate-50">
        <div className="max-w-md text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 mx-auto flex items-center justify-center mb-4">
            <AlertCircle size={28} className="text-amber-600" />
          </div>
          <h1 className="text-xl font-semibold text-slate-800 mb-2">Magazine needs server storage</h1>
          <p className="text-sm text-slate-500 leading-relaxed">
            Issues live in Postgres. Start the DB and reload.
          </p>
          <button onClick={refresh} className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
            Refresh
          </button>
        </div>
      </div>
    );
  }

  if (!active && issues.length === 0 && !generating) {
    return (
      <div className="h-full overflow-y-auto main-scroll bg-gradient-to-br from-slate-50 via-amber-50/30 to-rose-50/30">
        <div className="max-w-3xl mx-auto px-8 py-16 fade-in">
          <div className="text-center">
            <div className="inline-flex w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-500 via-amber-500 to-orange-500 items-center justify-center text-white shadow-lg shadow-orange-500/30 mb-5">
              <Newspaper size={28} />
            </div>
            <h1 className="text-3xl font-bold text-slate-800 mb-2">Your weekly research magazine</h1>
            <p className="text-slate-600 max-w-lg mx-auto leading-relaxed">
              A digest of what's happening across your inbox, trending models, top repos, and the broader ML community.
            </p>
            <button
              onClick={() => setPickerOpen(true)}
              disabled={generating}
              className="mt-6 inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-rose-500 via-amber-500 to-orange-500 text-white font-semibold rounded-xl hover:opacity-95 shadow-lg shadow-orange-500/30 transition-all"
            >
              {generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              Generate this week's issue
            </button>

            <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl mx-auto">
              <SourceTeaser icon={<BookOpen size={16} className="text-blue-500" />} title="Your inbox" desc="Top-rated arXiv papers from your digest this week." />
              <SourceTeaser icon={<MessageSquare size={16} className="text-orange-500" />} title="Hacker News" desc="AI/ML stories at the top of HN, filtered." />
              <SourceTeaser icon={<Cpu size={16} className="text-violet-500" />} title="HuggingFace" desc="Currently-trending models with downloads + likes." />
              <SourceTeaser icon={<GitBranch size={16} className="text-emerald-500" />} title="GitHub" desc="Repos created in the past week with rapid star growth." />
            </div>
            {error && <p className="text-sm text-red-600 mt-5">{error}</p>}
          </div>
        </div>
        {pickerOpen && <GeneratePicker onClose={() => setPickerOpen(false)} onGenerate={async opts => { setPickerOpen(false); await generateThisWeek(opts); }} />}
      </div>
    );
  }

  const aiOn = hasAI(settings);

  return (
    <div className="h-full overflow-y-auto main-scroll bg-slate-50">
      <div className="max-w-4xl mx-auto px-8 py-8 fade-in">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-6 gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 via-amber-500 to-orange-500 flex items-center justify-center text-white shadow-sm">
              <Newspaper size={20} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Magazine</h1>
              <p className="text-sm text-slate-500">{issues.length} issue{issues.length !== 1 ? 's' : ''} · {aiOn ? `editorial via ${providerLabel(resolveAIConfig(settings))}` : 'no AI editorial (configure provider for one)'}</p>
            </div>
          </div>
          <button
            onClick={() => setPickerOpen(true)}
            disabled={generating}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-rose-500 to-orange-500 text-white text-sm font-medium rounded-lg hover:opacity-95 disabled:opacity-50 shadow-sm"
          >
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {generating ? 'Generating…' : 'New issue'}
          </button>
        </div>

        {error && (
          <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
            <AlertCircle size={15} className="shrink-0 mt-0.5" /><span>{error}</span>
          </div>
        )}

        <AutoPrefsStrip />

        {active && (
          <IssueReader
            issue={active}
            onOpenPaper={p => setSelectedPaper(p)}
            onDelete={async () => {
              const ok = await confirm({
                title: 'Delete this issue?',
                message: `"${active.title}" — Edition #${active.editionNumber}. This can't be undone.`,
                destructive: true,
                confirmLabel: 'Delete',
              });
              if (ok) removeIssue(active.id);
            }}
            onGenerateEditorial={() => generateEditorialFor(active.id)}
            editorialBusy={editorialBusy}
            editorialError={editorialError}
          />
        )}
      </div>
      {pickerOpen && <GeneratePicker onClose={() => setPickerOpen(false)} onGenerate={async opts => { setPickerOpen(false); await generateThisWeek(opts); }} />}
    </div>
  );
}

// =========================================================================
// Issue reader
// =========================================================================

function IssueReader({
  issue, onOpenPaper, onDelete, onGenerateEditorial, editorialBusy, editorialError,
}: {
  issue: import('../types').MagazineIssue;
  onOpenPaper: (p: Paper) => void;
  onDelete: () => void;
  onGenerateEditorial: () => void;
  editorialBusy: boolean;
  editorialError: string | null;
}) {
  const { settings } = usePapers();
  const aiOn = hasAI(settings);
  const c = issue.content;
  const hasEditorial = !!c.editorial && (c.editorial.cover || c.editorial.inboxNote || (c.editorial.takeaways?.length ?? 0) > 0);

  // Memoize the heavy paths so re-renders from parent contexts (papers,
  // tracking, activity log, etc.) don't re-shape and re-sort the full
  // inbox array on every tick.
  const inboxPapers = useMemo(
    () => (c.inboxPapers ?? []).map(p => ({
      ...p,
      digestDate: typeof p.digestDate === 'string' ? new Date(p.digestDate) : p.digestDate,
    })),
    [c.inboxPapers],
  );
  const topInbox = useMemo(
    () => [...inboxPapers].sort((a, b) => computeAssessment(b).score - computeAssessment(a).score).slice(0, 6),
    [inboxPapers],
  );
  // Honour the canonical total from the server when present; fall back
  // to the stored array length for older issues that pre-date the field.
  const inboxTotalCount = c.inboxTotalCount ?? inboxPapers.length;

  return (
    <article className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Cover */}
      <header className="relative px-8 py-10 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white overflow-hidden">
        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_20%_20%,rgba(244,114,182,0.5),transparent_40%),radial-gradient(circle_at_80%_60%,rgba(251,146,60,0.4),transparent_40%)]" />
        <div className="relative">
          <p className="text-[11px] uppercase tracking-widest text-amber-300/80 font-semibold flex items-center gap-2">
            <Calendar size={11} />
            {prettyDate(issue.weekStart)} – {prettyDate(issue.weekEnd)}
            <span className="text-slate-500">·</span>
            Edition #{issue.editionNumber}
          </p>
          <h2 className="text-3xl font-bold mt-2 leading-tight">{issue.title}</h2>
          {c.editorial?.cover && (
            <p className="text-base text-slate-300 mt-4 max-w-2xl leading-relaxed">{c.editorial.cover}</p>
          )}
          <div className="mt-5 flex items-center gap-2 text-xs">
            {issue.aiProvider && (
              <span className="px-2.5 py-1 rounded-full bg-violet-500/20 border border-violet-400/40 text-violet-200 flex items-center gap-1.5">
                <Sparkles size={10} /> editorial · {providerLabel({ provider: issue.aiProvider as never })}
              </span>
            )}
            {issue.sources.map(s => (
              <span key={s} className="px-2 py-0.5 rounded-full bg-white/10 text-slate-300 text-[10px] uppercase tracking-wider font-semibold">
                {SOURCE_LABEL[s] ?? s}
              </span>
            ))}
            <span className="ml-auto text-[11px] text-slate-400">
              {formatDistanceToNow(new Date(issue.createdAt), { addSuffix: true })}
            </span>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="p-8 space-y-10">
        {/* Missing-editorial CTA (auto-generated issues / failed generations) */}
        {!hasEditorial && (
          <section className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 px-5 py-4 flex items-start gap-3">
            <Sparkles size={18} className="text-violet-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800">No editorial yet</p>
              <p className="text-xs text-slate-600 mt-0.5">
                {aiOn
                  ? 'Auto-generated issues have no editorial commentary (the server can\'t reach your AI provider). Click to compose one now using your configured provider.'
                  : 'Configure an AI provider in Settings to generate editorial commentary for this issue.'}
              </p>
              {editorialError && (
                <p className="text-xs text-amber-700 mt-2 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 inline-block">
                  <AlertCircle size={11} className="inline -mt-0.5 mr-1" />
                  {editorialError}
                </p>
              )}
            </div>
            <button
              onClick={onGenerateEditorial}
              disabled={editorialBusy || !aiOn}
              className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
            >
              {editorialBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {editorialBusy ? 'Composing…' : 'Generate editorial'}
            </button>
          </section>
        )}

        {/* Re-run banner for issues that DO have an editorial but the user
            wants to re-compose, OR show last error if one happened */}
        {hasEditorial && editorialError && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 flex items-start gap-2">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>Last editorial attempt failed: {editorialError}</span>
            <button onClick={onGenerateEditorial} disabled={editorialBusy} className="ml-auto text-xs text-amber-900 hover:underline font-medium">
              {editorialBusy ? 'retrying…' : 'retry'}
            </button>
          </div>
        )}

        {/* Editorial takeaways */}
        {c.editorial?.takeaways && c.editorial.takeaways.length > 0 && (
          <Section title="This week's takeaways" icon={<Sparkles size={14} className="text-violet-500" />}>
            <ul className="space-y-2">
              {c.editorial.takeaways.map((t, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-slate-700 leading-relaxed">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-gradient-to-br from-rose-100 to-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Inbox papers */}
        {topInbox.length > 0 && (
          <Section title={`From your inbox · ${inboxTotalCount.toLocaleString()} this week`} icon={<BookOpen size={14} className="text-blue-500" />}>
            {c.editorial?.inboxNote && (
              <p className="text-sm text-slate-600 italic leading-relaxed mb-4 border-l-2 border-blue-200 pl-3">{c.editorial.inboxNote}</p>
            )}
            <div className="space-y-2">
              {topInbox.map(p => {
                const a = computeAssessment(p);
                return (
                  <button
                    key={p.id}
                    onClick={() => onOpenPaper(p)}
                    className="w-full text-left bg-slate-50 hover:bg-blue-50 hover:border-blue-200 border border-slate-200 rounded-lg px-4 py-3 transition-all group"
                  >
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {p.categories.slice(0, 3).map(cat => (
                        <span key={cat} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${CATEGORY_COLORS_LIGHT[cat] ?? CATEGORY_COLORS_LIGHT.default}`}>{cat}</span>
                      ))}
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ml-auto ${ASSESSMENT_BADGE[a.label]}`}>{a.label}</span>
                    </div>
                    <p className="text-sm font-medium text-slate-800 group-hover:text-blue-700 transition-colors leading-snug line-clamp-2">{p.title}</p>
                    <p className="text-xs text-slate-500 mt-1 truncate">{p.authorList[0] ?? '—'}{p.authorList.length > 1 ? ' et al.' : ''} · arXiv:{p.arxivId}</p>
                  </button>
                );
              })}
            </div>
          </Section>
        )}

        {/* HN */}
        {c.external?.hackernews && c.external.hackernews.length > 0 && (
          <Section title="Around the AI internet" subtitle="from Hacker News" icon={<MessageSquare size={14} className="text-orange-500" />}>
            <HNList items={c.external.hackernews} />
          </Section>
        )}

        {/* News */}
        {c.external?.news && c.external.news.length > 0 && (
          <Section title="In the headlines" subtitle="AI & ML news from around the web" icon={<Newspaper size={14} className="text-sky-500" />}>
            <NewsList items={c.external.news} />
          </Section>
        )}

        {/* HuggingFace */}
        {c.external?.huggingface && c.external.huggingface.length > 0 && (
          <Section title="Trending models" subtitle="from HuggingFace" icon={<Cpu size={14} className="text-violet-500" />}>
            <HFList items={c.external.huggingface} />
          </Section>
        )}

        {/* GitHub */}
        {c.external?.github && c.external.github.length > 0 && (
          <Section title="New on GitHub" subtitle="repos that picked up stars this week" icon={<GitBranch size={14} className="text-emerald-500" />}>
            <GHList items={c.external.github} />
          </Section>
        )}

        {/* ModelScope */}
        {c.external?.modelscope && c.external.modelscope.length > 0 && (
          <Section title="ModelScope" icon={<Cpu size={14} className="text-rose-500" />}>
            <MSList items={c.external.modelscope} />
          </Section>
        )}

        {/* Source errors */}
        {c.sourceErrors && Object.keys(c.sourceErrors).length > 0 && (
          <div className="text-[11px] text-slate-400 border-t border-slate-100 pt-4">
            <p className="font-semibold mb-1">Some sources unavailable this week:</p>
            <ul className="space-y-0.5">
              {Object.entries(c.sourceErrors).map(([k, v]) => <li key={k}>· {SOURCE_LABEL[k as MagazineSource] ?? k}: {v}</li>)}
            </ul>
          </div>
        )}

        {/* Footer actions */}
        <div className="pt-4 border-t border-slate-100 flex items-center justify-end">
          <button
            onClick={onDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <Trash2 size={12} /> Delete issue
          </button>
        </div>
      </div>
    </article>
  );
}

// =========================================================================
// Source-specific list renderers
// =========================================================================

const HNList = memo(function HNList({ items }: { items: MagazineHNItem[] }) {
  // Each row needs TWO links (article + HN discussion), and nesting <a>
  // inside <a> is invalid HTML. Use a clickable <div role="link"> as the
  // outer wrapper so the inner HN-discussion <a> stays a real link.
  const openArticle = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');
  return (
    <div className="space-y-1.5">
      {items.map(h => (
        <div
          key={h.id}
          role="link"
          tabIndex={0}
          onClick={() => openArticle(h.url)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openArticle(h.url); } }}
          className="group flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-orange-50 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-orange-300"
        >
          <div className="shrink-0 w-10 h-10 rounded-md bg-orange-100 text-orange-700 text-xs font-bold flex flex-col items-center justify-center">
            <span>{h.points}</span>
            <span className="text-[8px] uppercase tracking-wider text-orange-500/70">pts</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-800 group-hover:text-orange-700 transition-colors line-clamp-2">{h.title}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {hostFromUrl(h.url)} · {h.comments} comment{h.comments !== 1 ? 's' : ''} ·{' '}
              <a href={h.discussion} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-orange-600 hover:underline">HN discussion</a>
            </p>
          </div>
        </div>
      ))}
    </div>
  );
});

const NewsList = memo(function NewsList({ items }: { items: MagazineNewsItem[] }) {
  return (
    <div className="space-y-1.5">
      {items.map(n => (
        <a
          key={n.id}
          href={n.url}
          target="_blank"
          rel="noreferrer"
          className="group flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-sky-50 transition-colors"
        >
          <div className="shrink-0 w-9 h-9 rounded-md bg-sky-100 text-sky-600 flex items-center justify-center mt-0.5">
            <Newspaper size={15} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-800 group-hover:text-sky-700 transition-colors line-clamp-2">{n.title}</p>
            {n.summary && <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{n.summary}</p>}
            <p className="text-[11px] text-slate-400 mt-0.5">{n.source}{n.ts ? ` · ${formatDistanceToNow(new Date(n.ts), { addSuffix: true })}` : ''}</p>
          </div>
          <ExternalLink size={11} className="text-slate-300 group-hover:text-sky-500 shrink-0 mt-1" />
        </a>
      ))}
    </div>
  );
});

const HFList = memo(function HFList({ items }: { items: MagazineHFItem[] }) {
  return (
    <div className="grid sm:grid-cols-2 gap-2">
      {items.map(m => (
        <a key={m.id} href={m.url} target="_blank" rel="noreferrer" className="group rounded-lg border border-slate-200 hover:border-violet-300 hover:shadow-sm transition-all px-3.5 py-3 bg-white">
          <div className="flex items-start gap-2 mb-1">
            <p className="text-sm font-semibold text-slate-800 group-hover:text-violet-700 transition-colors line-clamp-1 flex-1 min-w-0">{m.name}</p>
            <ExternalLink size={11} className="text-slate-300 group-hover:text-violet-500 shrink-0 mt-0.5" />
          </div>
          <p className="text-[11px] text-slate-500 mb-2">
            ⬇ {compactNumber(m.downloads)} downloads · ♥ {compactNumber(m.likes)} {m.pipeline ? `· ${m.pipeline}` : ''}
          </p>
          {m.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {m.tags.slice(0, 4).map(t => <span key={t} className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-50 text-violet-600 border border-violet-100">{t}</span>)}
            </div>
          )}
        </a>
      ))}
    </div>
  );
});

const GHList = memo(function GHList({ items }: { items: MagazineGitHubItem[] }) {
  return (
    <div className="space-y-2">
      {items.map(r => (
        <a key={r.id} href={r.url} target="_blank" rel="noreferrer" className="group flex items-start gap-3 rounded-lg border border-slate-200 hover:border-emerald-300 hover:shadow-sm transition-all px-3.5 py-3 bg-white">
          {r.ownerAvatar && <img src={r.ownerAvatar} alt={r.owner} className="w-9 h-9 rounded-full shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-slate-800 group-hover:text-emerald-700 transition-colors">{r.name}</p>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-0.5"><Star size={9} /> {compactNumber(r.stars)}</span>
              <span className="text-[10px] text-slate-400">{r.language}</span>
            </div>
            {r.description && <p className="text-xs text-slate-600 mt-1 line-clamp-2 leading-relaxed">{r.description}</p>}
          </div>
        </a>
      ))}
    </div>
  );
});

const MSList = memo(function MSList({ items }: { items: MagazineMSItem[] }) {
  return (
    <div className="grid sm:grid-cols-2 gap-2">
      {items.map(m => (
        <a key={m.id} href={m.url} target="_blank" rel="noreferrer" className="group rounded-lg border border-slate-200 hover:border-rose-300 hover:shadow-sm transition-all px-3.5 py-3 bg-white">
          <p className="text-sm font-semibold text-slate-800 group-hover:text-rose-700 transition-colors line-clamp-1">{m.name}</p>
          {m.chineseName && <p className="text-[11px] text-slate-500 mt-0.5">{m.chineseName}</p>}
          <p className="text-[11px] text-slate-500 mt-1">⬇ {compactNumber(m.downloads)} · ★ {compactNumber(m.stars)}</p>
        </a>
      ))}
    </div>
  );
});

// =========================================================================
// Generate picker (modal) — pick sources + AI toggle
// =========================================================================

function GeneratePicker({ onClose, onGenerate }: { onClose: () => void; onGenerate: (opts: { sources?: MagazineSource[]; useAi?: boolean }) => Promise<void>; }) {
  const { settings } = usePapers();
  const aiOn = hasAI(settings);
  const [selected, setSelected] = useState<Set<MagazineSource>>(new Set(['hackernews', 'news', 'huggingface', 'github']));
  const [useAi, setUseAi] = useState(aiOn);

  function toggle(s: MagazineSource) {
    const next = new Set(selected);
    if (next.has(s)) next.delete(s); else next.add(s);
    setSelected(next);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl p-6 fade-in">
        <h2 className="text-lg font-semibold text-slate-800 mb-1 flex items-center gap-2">
          <Newspaper size={18} className="text-rose-500" />
          New issue
        </h2>
        <p className="text-sm text-slate-500 mb-5">Pick the sources you want included.</p>

        <div className="space-y-2">
          {(['hackernews', 'news', 'huggingface', 'github', 'modelscope'] as MagazineSource[]).map(s => (
            <label key={s} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer transition-colors">
              <input type="checkbox" checked={selected.has(s)} onChange={() => toggle(s)} className="w-4 h-4 accent-rose-500" />
              <span className="text-sm font-medium text-slate-700">{SOURCE_LABEL[s]}</span>
            </label>
          ))}
        </div>

        <label className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer transition-colors mt-3">
          <input type="checkbox" checked={useAi} onChange={e => setUseAi(e.target.checked)} disabled={!aiOn} className="w-4 h-4 accent-violet-500" />
          <span className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
            <Sparkles size={12} className="text-violet-500" />
            Generate AI editorial
            {!aiOn && <span className="text-[10px] text-slate-400 font-normal ml-1">(no provider configured)</span>}
          </span>
        </label>

        <div className="mt-6 flex gap-3 items-center">
          <div className="flex-1" />
          <button onClick={onClose} className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={() => onGenerate({ sources: [...selected], useAi })}
            disabled={selected.size === 0}
            className="px-5 py-2 bg-gradient-to-r from-rose-500 to-orange-500 text-white text-sm font-medium rounded-lg hover:opacity-95 disabled:opacity-40 flex items-center gap-2"
          >
            <ArrowRight size={14} /> Generate
          </button>
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// Small UI helpers
// =========================================================================

function Section({ title, subtitle, icon, children }: { title: string; subtitle?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline gap-2 mb-3 border-b border-slate-100 pb-2">
        {icon}
        <h3 className="text-base font-bold text-slate-800">{title}</h3>
        {subtitle && <span className="text-xs text-slate-500">{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

function SourceTeaser({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 text-left">
      <div className="flex items-center gap-2 mb-1">{icon}<p className="text-sm font-semibold text-slate-800">{title}</p></div>
      <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
    </div>
  );
}

// =========================================================================
// Auto-generation strip — opt-in weekly schedule
// =========================================================================

const DAY_NAMES: Record<number, string> = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 7: 'Sunday' };

function AutoPrefsStrip() {
  const [prefs, setPrefs] = useState<MagazineAutoPrefs | null>(null);
  const [busy, setBusy]   = useState(false);
  const [open, setOpen]   = useState(false);

  useEffect(() => { apiGetMagazineAutoPrefs().then(setPrefs).catch(() => {}); }, []);

  async function save(patch: Partial<MagazineAutoPrefs>) {
    setBusy(true);
    try {
      const next = await apiSetMagazineAutoPrefs(patch);
      setPrefs(next);
    } finally {
      setBusy(false);
    }
  }

  if (!prefs) return null;

  return (
    <div className="mb-5 rounded-xl border border-slate-200 bg-white px-4 py-3 flex items-center gap-3 text-sm">
      <Clock size={15} className={prefs.auto ? 'text-rose-500' : 'text-slate-400'} />
      <div className="flex-1 min-w-0">
        {prefs.auto ? (
          <p className="text-slate-700">
            <span className="font-medium">Auto-generate</span> every <span className="font-semibold">{DAY_NAMES[prefs.dayOfWeek]}</span> at <span className="font-semibold">{prefs.hour.toString().padStart(2, '0')}:00 UTC</span>
            {prefs.lastAutoRun && <span className="text-slate-400"> · last run {formatDistanceToNow(new Date(prefs.lastAutoRun), { addSuffix: true })}</span>}
          </p>
        ) : (
          <p className="text-slate-500">
            Magazine isn't auto-generated. <button onClick={() => save({ auto: true })} className="text-rose-600 hover:underline font-medium">Enable weekly</button> to get a fresh issue every Monday morning.
          </p>
        )}
      </div>
      {prefs.auto && (
        <>
          <button
            onClick={() => setOpen(o => !o)}
            disabled={busy}
            className="text-xs px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            {open ? 'Done' : 'Edit'}
          </button>
          <button
            onClick={() => save({ auto: false })}
            disabled={busy}
            className="text-xs px-2.5 py-1 rounded-md text-red-600 hover:bg-red-50"
          >
            Disable
          </button>
        </>
      )}
      {open && prefs.auto && (
        <div className="absolute right-8 mt-44 w-72 z-30 bg-white border border-slate-200 rounded-xl shadow-lg p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">Schedule</p>
          <div className="space-y-2">
            <label className="text-xs text-slate-600 block">
              Day of week
              <select
                value={prefs.dayOfWeek}
                onChange={e => save({ dayOfWeek: parseInt(e.target.value, 10) })}
                disabled={busy}
                className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded-md text-sm"
              >
                {Object.entries(DAY_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-600 block">
              Hour (UTC)
              <select
                value={prefs.hour}
                onChange={e => save({ hour: parseInt(e.target.value, 10) })}
                disabled={busy}
                className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded-md text-sm"
              >
                {Array.from({ length: 24 }).map((_, h) => <option key={h} value={h}>{h.toString().padStart(2, '0')}:00</option>)}
              </select>
            </label>
            <p className="text-[10px] text-slate-400 leading-relaxed pt-1">
              The server checks every 5 minutes. Auto-issues have no AI editorial — open the issue and click "compute editorial" to add one with your configured AI provider.
            </p>
            {busy && <p className="text-[10px] text-slate-400 flex items-center gap-1"><Check size={9} /> saving…</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function prettyDate(isoDate: string): string {
  try { return format(new Date(isoDate), 'MMM d, yyyy'); } catch { return isoDate; }
}

function compactNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + 'k';
  return String(n);
}

function hostFromUrl(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
