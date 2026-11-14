import { useState, useEffect, useMemo, useRef } from 'react';
import { usePapers } from '../contexts/PapersContext';
import { useLibrary } from '../contexts/LibraryContext';
import { useTracking } from '../contexts/TrackingContext';
import { publisherOf } from '../utils/publisher';
import {
  apiGetPaperComments, apiAddPaperComment, apiDeletePaperComment, apiGetCommentCounts,
  apiGetOrganizations, apiGetPaperFigure, apiGetPaperFigures, apiGetRelevantPapers,
} from '../utils/researchApi';
import { format, formatDistanceToNow } from 'date-fns';
import {
  BookOpen, ChevronLeft, ChevronRight, Heart, Bookmark, BookmarkCheck, MessageCircle,
  ExternalLink, Loader2, Image as ImageIcon, RefreshCw, Target,
} from 'lucide-react';
import type { Paper, PaperComment } from '../types';

const FEED_BATCH_SIZE = 10;

export default function Dashboard() {
  const { papers } = usePapers();
  if (papers.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center">
        <BookOpen size={28} className="mb-4 text-slate-400" />
        <h2 className="text-xl font-semibold text-slate-700">No papers yet</h2>
        <p className="mt-2 text-sm text-slate-400">Connect your email and sync to load arXiv digest emails.</p>
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto main-scroll bg-[#f6f6f3]">
      <div className="mx-auto max-w-[780px] px-5 pb-8 pt-8 sm:px-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Your research desk</p>
        <h1 className="mt-2 font-serif text-[32px] leading-none tracking-tight text-slate-900">For you</h1>
        <p className="mt-3 text-[13px] text-slate-500">The best matches for your research interests, regardless of publication date.</p>
        <FeedTab />
      </div>
    </div>
  );
}

// =========================================================================
// Optional comments; the feed itself has only a relevance ranking and refresh.
// =========================================================================

const LOCAL_COMMENTS_KEY = 'arxiv_paper_comments';
type CommentMap = Record<string, PaperComment[]>;

function readLocalCommentMap(): CommentMap {
  try {
    const raw = localStorage.getItem(LOCAL_COMMENTS_KEY);
    const parsed = raw ? JSON.parse(raw) as CommentMap : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function writeLocalCommentMap(map: CommentMap) {
  try { localStorage.setItem(LOCAL_COMMENTS_KEY, JSON.stringify(map)); } catch { /* best effort */ }
}

function localCommentsFor(paperId: string): PaperComment[] {
  return readLocalCommentMap()[paperId] ?? [];
}

function FeedTab() {
  const {
    papers, readIds, setSelectedPaper, markRead, markUnread, storageMode, updatePaperMeta,
  } = usePapers();
  const { isLiked, likePaper, unlikePaper, isSaved, savePaper, unsavePaper } = useLibrary();
  const { trackers, scores, ready: trackersReady } = useTracking();
  const [page, setPage] = useState(0);
  const [feed, setFeed] = useState<{ papers: Paper[]; total: number }>({ papers: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedAbstract, setExpandedAbstract] = useState<Set<string>>(new Set());
  const [openComments, setOpenComments] = useState<Set<string>>(new Set());
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [orgMap, setOrgMap] = useState<Record<string, string | null>>({});
  const [orgTick, setOrgTick] = useState(0);
  const orgPolls = useRef(0);

  const localMatches = useMemo(() => {
    const enabled = new Map(trackers.filter(t => t.enabled).map(t => [t.id, t]));
    const best = new Map<string, NonNullable<Paper['relevance']>>();
    for (const score of scores) {
      const tracker = enabled.get(score.trackerId);
      if (!tracker || score.score < tracker.minScore) continue;
      const current = best.get(score.paperId);
      if (!current || score.score > current.score) {
        best.set(score.paperId, {
          score: score.score, trackerName: tracker.name, rationale: score.rationale,
        });
      }
    }
    return papers.filter(p => best.has(p.id))
      .map(p => ({ ...p, relevance: best.get(p.id)! }))
      .sort((a, b) => b.relevance!.score - a.relevance!.score
        || b.digestDate.getTime() - a.digestDate.getTime());
  }, [papers, trackers, scores]);

  useEffect(() => { setPage(0); }, [storageMode, trackersReady]);
  useEffect(() => {
    if (storageMode !== 'server') {
      setFeed({ papers: localMatches.slice(page * FEED_BATCH_SIZE, (page + 1) * FEED_BATCH_SIZE), total: localMatches.length });
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    apiGetRelevantPapers({ limit: FEED_BATCH_SIZE, offset: page * FEED_BATCH_SIZE })
      .then(result => {
        if (cancelled) return;
        if (result.papers.length === 0 && page > 0) setPage(0);
        else setFeed(result);
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load your feed.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [storageMode, localMatches, page, trackersReady]);

  const displayedPapers = feed.papers.slice(0, FEED_BATCH_SIZE);
  const pageKey = displayedPapers.map(p => p.id).join(',');
  const total = storageMode === 'server' ? feed.total : localMatches.length;
  const enabledTrackers = trackers.filter(t => t.enabled);

  const refresh = () => {
    if (total === 0) return;
    setPage(current => (current + 1) % Math.max(1, Math.ceil(total / FEED_BATCH_SIZE)));
  };

  useEffect(() => { orgPolls.current = 0; setOrgTick(0); }, [pageKey]);
  useEffect(() => {
    if (storageMode !== 'server' || !pageKey) return;
    let cancelled = false;
    let timer: number | undefined;
    apiGetOrganizations(pageKey.split(','))
      .then(({ organizations, pending }) => {
        if (cancelled) return;
        setOrgMap(prev => ({ ...prev, ...organizations }));
        if (pending.length > 0 && orgPolls.current < 12) {
          orgPolls.current += 1;
          timer = window.setTimeout(() => setOrgTick(t => t + 1), 15_000);
        }
      })
      .catch(e => console.warn('[feed] organization lookup failed', e));
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [pageKey, storageMode, orgTick]);

  useEffect(() => {
    if (!pageKey) return;
    let cancelled = false;
    const ids = pageKey.split(',');
    if (storageMode === 'server') {
      apiGetCommentCounts(ids)
        .then(counts => { if (!cancelled) setCommentCounts(prev => ({ ...prev, ...counts })); })
        .catch(e => console.warn('[feed] comment counts failed', e));
    } else {
      const map = readLocalCommentMap();
      const counts: Record<string, number> = {};
      for (const id of ids) counts[id] = (map[id] ?? []).length;
      setCommentCounts(prev => ({ ...prev, ...counts }));
    }
    return () => { cancelled = true; };
  }, [pageKey, storageMode]);

  const toggleSetItem = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => {
    setter(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center justify-between gap-4">
        <p className="text-[12px] text-slate-500">
          {total > 0 ? `${total.toLocaleString()} papers matching your trackers` : 'Papers matching your trackers'}
        </p>
        <button
          type="button" onClick={refresh} disabled={loading || total <= FEED_BATCH_SIZE}
          aria-label="Show the next 10 relevant papers" title="Show the next 10 relevant papers"
          className="inline-flex items-center gap-1.5 rounded-md border border-[#e7e5df] bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:text-slate-900 disabled:cursor-default disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && <p role="alert" className="mb-3 text-[12px] text-rose-600">{error}</p>}
      {!loading && displayedPapers.length === 0 ? (
        <div className="rounded-xl border border-[#e7e5df] bg-white px-6 py-16 text-center">
          <Target size={24} className="mx-auto mb-3 text-slate-400" />
          <h2 className="font-serif text-xl text-slate-700">
            {enabledTrackers.length === 0 ? 'Set up a research interest to personalize your feed.' : 'No papers currently meet your tracker thresholds.'}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-[12px] leading-relaxed text-slate-500">
            {enabledTrackers.length === 0
              ? 'Create and enable a tracker. Existing papers will be ranked by interest, not just by how new they are.'
              : 'You can lower a tracker’s minimum score or use its scoring action to find more relevant papers.'}
          </p>
        </div>
      ) : (
        <div className={`space-y-5 ${loading ? 'opacity-60' : ''}`}>
          {displayedPapers.map(paper => {
            const pub = publisherOf(paper);
            const read = readIds.has(paper.id);
            const liked = isLiked(paper.id);
            const saved = isSaved(paper.id);
            const expanded = expandedAbstract.has(paper.id);
            const showingComments = openComments.has(paper.id);
            const abstract = paper.abstract?.trim() ?? '';
            const org = orgMap[paper.id] !== undefined ? orgMap[paper.id] : paper.organization;
            const href = paper.url || `https://arxiv.org/abs/${paper.arxivId}`;
            return (
              <article key={paper.id} className="overflow-hidden rounded-xl border border-[#e7e5df] bg-white shadow-[0_1px_2px_rgba(25,25,20,0.04)]">
                <div className="px-5 py-5 sm:px-6">
                  <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400">
                    <span>{org || pub.name}</span><span>·</span>
                    <time dateTime={paper.digestDate.toISOString()} title={format(paper.digestDate, 'PPpp')}>
                      {format(paper.digestDate, 'MMM d, yyyy')}
                    </time>
                    {paper.relevance && (
                      <span className="ml-auto inline-flex items-center gap-1 font-medium text-sky-700" title={paper.relevance.rationale}>
                        <Target size={11} /> {paper.relevance.score} · {paper.relevance.trackerName}
                      </span>
                    )}
                  </header>
                  <button onClick={() => { markRead(paper.id); setSelectedPaper(paper); }} className="mt-2 block w-full text-left">
                    <h2 className={`text-[18px] leading-[1.4] tracking-[-0.015em] ${read ? 'font-medium text-slate-700' : 'font-semibold text-slate-950'}`}>{paper.title}</h2>
                  </button>
                  <p className="mt-1 truncate text-[12px] text-slate-500">{paper.authors || paper.authorList.join(', ')}</p>
                  {abstract && (
                    <div className="mt-2.5">
                      <p className={`text-[14px] leading-[1.7] text-slate-600 ${expanded ? '' : 'line-clamp-3'}`}>{abstract}</p>
                      {abstract.length > 280 && <button onClick={() => toggleSetItem(setExpandedAbstract, paper.id)} className="mt-1 text-[12px] text-slate-500 hover:text-slate-900">{expanded ? 'Show less' : 'Show more'}</button>}
                    </div>
                  )}
                  <PaperImagePreview paper={paper} storageMode={storageMode} updatePaperMeta={updatePaperMeta} />
                  <div className="mt-4 flex items-center gap-5 text-[12px] text-slate-500">
                    <button onClick={() => liked ? unlikePaper(paper.id) : likePaper(paper)} className={`flex items-center gap-1.5 ${liked ? 'text-rose-600' : 'hover:text-rose-600'}`}>
                      <Heart size={15} className={liked ? 'fill-current' : ''} /> {liked ? 'Liked' : 'Like'}
                    </button>
                    <button onClick={() => toggleSetItem(setOpenComments, paper.id)} className={`flex items-center gap-1.5 ${showingComments ? 'text-sky-600' : 'hover:text-sky-600'}`}>
                      <MessageCircle size={15} /> {commentCounts[paper.id] || 'Comment'}
                    </button>
                    <button onClick={() => saved ? unsavePaper(paper.id) : savePaper(paper)} className={`flex items-center gap-1.5 ${saved ? 'text-amber-600' : 'hover:text-amber-600'}`}>
                      {saved ? <BookmarkCheck size={15} /> : <Bookmark size={15} />} {saved ? 'Saved' : 'Save'}
                    </button>
                    <div className="ml-auto flex items-center gap-3">
                      <button onClick={() => read ? markUnread(paper.id) : markRead(paper.id)} className="hover:text-slate-950">{read ? 'Unread' : 'Read'}</button>
                      <a href={href} target="_blank" rel="noreferrer" onClick={() => markRead(paper.id)} className="flex items-center gap-1 hover:text-slate-950"><ExternalLink size={13} /> Open</a>
                    </div>
                  </div>
                  {showingComments && <CommentThread paperId={paper.id} onCountChange={n => setCommentCounts(prev => ({ ...prev, [paper.id]: n }))} />}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function PaperImagePreview({ paper, storageMode, updatePaperMeta }: {
  paper: Paper;
  storageMode: 'idb' | 'server';
  updatePaperMeta: (id: string, patch: Partial<Paper>) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const requested = useRef(false);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<'idle' | 'loading' | 'image' | 'none' | 'error'>(
    paper.thumbnailChecked && !paper.thumbnailAvailable ? 'none' : 'idle',
  );
  const [figures, setFigures] = useState<Array<{ index: number; pageNumber?: number | null; width: number; height: number }>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (storageMode !== 'server' || (paper.thumbnailChecked && !paper.thumbnailAvailable)) return;
    if (requested.current) return;
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    const load = async () => {
      if (requested.current || cancelled) return;
      requested.current = true;
      setState('loading');
      try {
        const result = await apiGetPaperFigures(paper.id);
        if (cancelled) return;
        setFigures(result);
        setState(result.length > 0 ? 'image' : 'none');
        updatePaperMeta(paper.id, { thumbnailChecked: true, thumbnailAvailable: result.length > 0 });
      } catch (e) {
        if (!cancelled) { setState('error'); console.warn(`[feed] figure extraction failed for ${paper.arxivId}:`, e); }
      }
    };
    if (typeof IntersectionObserver === 'undefined') { void load(); return () => { cancelled = true; }; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void load(); }
    }, { rootMargin: '180px 0px' });
    observer.observe(host);
    return () => { cancelled = true; observer.disconnect(); };
  }, [paper.id, paper.arxivId, paper.thumbnailChecked, paper.thumbnailAvailable, storageMode, retry, updatePaperMeta]);

  useEffect(() => {
    const figure = figures[activeIndex];
    if (state !== 'image' || !figure) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setImageUrl(null);
    apiGetPaperFigure(paper.id, figure.index)
      .then(blob => { if (!cancelled) { objectUrl = URL.createObjectURL(blob); setImageUrl(objectUrl); } })
      .catch(e => { if (!cancelled) { setState('error'); console.warn(`[feed] figure image failed for ${paper.arxivId}:`, e); } });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [paper.id, paper.arxivId, state, figures, activeIndex]);

  if (state === 'none' || storageMode !== 'server') return null;
  return (
    <div ref={hostRef} className="mt-3">
      {state === 'image' && figures.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-[#e7e5df] bg-white">
          <div className="relative flex h-[min(65vh,420px)] min-h-[140px] items-center justify-center bg-[#fafaf8]" aria-roledescription="carousel" aria-label={`Figures from ${paper.title}`}>
            {imageUrl ? (
              <img src={imageUrl} alt={`Figure ${activeIndex + 1} from ${paper.title}${figures[activeIndex].pageNumber ? `, page ${figures[activeIndex].pageNumber}` : ''}`} draggable={false} className="block h-full w-full select-none object-contain" />
            ) : <div className="flex items-center gap-2 text-[11px] text-slate-400"><Loader2 size={12} className="animate-spin" /> Loading figure…</div>}
            {figures.length > 1 && (
              <>
                <button type="button" aria-label="Previous figure" onClick={() => setActiveIndex(i => (i - 1 + figures.length) % figures.length)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full border border-white/70 bg-white/90 p-1.5 text-slate-700 shadow hover:bg-white"><ChevronLeft size={16} /></button>
                <button type="button" aria-label="Next figure" onClick={() => setActiveIndex(i => (i + 1) % figures.length)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full border border-white/70 bg-white/90 p-1.5 text-slate-700 shadow hover:bg-white"><ChevronRight size={16} /></button>
              </>
            )}
          </div>
          <div className="border-t border-[#eeede8] px-3 py-1.5 text-[10px] text-slate-400">
            Figure {activeIndex + 1} of {figures.length}{figures[activeIndex].pageNumber ? ` · page ${figures[activeIndex].pageNumber}` : ''}
          </div>
        </div>
      ) : state === 'loading' ? (
        <div className="flex items-center gap-2 text-[11px] text-slate-400"><Loader2 size={12} className="animate-spin" /> Finding figures…</div>
      ) : state === 'error' ? (
        <button onClick={() => { requested.current = false; setRetry(n => n + 1); }} className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-700"><ImageIcon size={12} /> Preview unavailable · retry</button>
      ) : null}
    </div>
  );
}

function CommentThread({ paperId, onCountChange }: { paperId: string; onCountChange: (n: number) => void }) {
  const { storageMode } = usePapers();
  const [comments, setComments] = useState<PaperComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (storageMode === 'server' ? apiGetPaperComments(paperId) : Promise.resolve(localCommentsFor(paperId)))
      .then(list => { if (!cancelled) { setComments(list); onCountChange(list.length); } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load comments'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [paperId, storageMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      let created: PaperComment;
      if (storageMode === 'server') created = await apiAddPaperComment(paperId, text);
      else {
        created = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, paperId, body: text, createdAt: Date.now() };
        const map = readLocalCommentMap();
        writeLocalCommentMap({ ...map, [paperId]: [...(map[paperId] ?? []), created] });
      }
      setComments(prev => { const next = [...prev, created]; onCountChange(next.length); return next; });
      setBody('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not post the comment'); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    try {
      if (storageMode === 'server') await apiDeletePaperComment(id);
      else {
        const map = readLocalCommentMap();
        writeLocalCommentMap({ ...map, [paperId]: (map[paperId] ?? []).filter(c => c.id !== id) });
      }
      setComments(prev => { const next = prev.filter(c => c.id !== id); onCountChange(next.length); return next; });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete the comment'); }
  };

  return (
    <div className="mt-4 space-y-3 border-l-2 border-slate-200 pl-4">
      {loading ? <Loader2 size={13} className="animate-spin text-slate-400" /> : comments.map(c => (
        <div key={c.id} className="group/c">
          <p className="whitespace-pre-wrap break-words text-[13px] text-slate-700">{c.body}</p>
          <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-400">
            <span>{formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}</span>
            <button onClick={() => void remove(c.id)} className="opacity-0 group-hover/c:opacity-100 hover:text-rose-600">Delete</button>
          </div>
        </div>
      ))}
      <div className="flex items-end gap-2">
        <textarea value={body} onChange={e => setBody(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }} rows={2} maxLength={4000} placeholder="Add a note" className="flex-1 resize-none border-b border-slate-300 bg-transparent py-1.5 text-[13px] focus:border-slate-900 focus:outline-none" />
        <button onClick={() => void submit()} disabled={busy || !body.trim()} className="pb-1.5 text-[12px] font-semibold text-slate-900 disabled:text-slate-300">{busy ? 'Posting…' : 'Post'}</button>
      </div>
      {error && <p className="text-[11px] text-rose-600">{error}</p>}
    </div>
  );
}
