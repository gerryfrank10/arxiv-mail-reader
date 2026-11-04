import { useState, useEffect, useMemo, useRef } from 'react';
import { usePapers } from '../contexts/PapersContext';
import { useLibrary } from '../contexts/LibraryContext';
import { computeAssessment, ASSESSMENT_BADGE } from '../utils/assessment';
import { CATEGORY_COLORS_LIGHT } from '../utils/categories';
import { computeAuthorStats, groupByVenue, detectVenue, type AuthorStat, type VenueGroup, FEATURED_AUTHORS } from '../utils/conferences';
import { publisherOf } from '../utils/publisher';
import { apiGetPaperComments, apiAddPaperComment, apiDeletePaperComment, apiGetCommentCounts, apiGetOrganizations } from '../utils/researchApi';
import { format, formatDistanceToNow } from 'date-fns';
import { BookOpen, Users, Presentation, ChevronRight, ArrowUpDown, Award, Rss, Heart, Bookmark, BookmarkCheck, MessageCircle, ExternalLink, Loader2 } from 'lucide-react';
import { usePagination } from '../hooks/usePagination';
import Pager from './Pager';
import type { Paper, PaperComment } from '../types';

type Tab = 'feed' | 'authors' | 'conferences';

const TABS: Array<{ value: Tab; label: string; icon: React.ReactNode }> = [
  { value: 'feed',         label: 'Feed',        icon: <Rss size={13} /> },
  { value: 'authors',      label: 'Authors',     icon: <Users size={13} /> },
  { value: 'conferences',  label: 'Conferences', icon: <Presentation size={13} /> },
];

type FeedFilter = 'all' | 'unread' | 'liked' | 'saved';

export default function Dashboard() {
  const { papers, stats, readIds, setSelectedPaper } = usePapers();
  const [tab, setTab] = useState<Tab>('feed');

  if (papers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
          <BookOpen size={28} className="text-slate-400" />
        </div>
        <h2 className="text-xl font-semibold text-slate-700 mb-2">No papers yet</h2>
        <p className="text-slate-400 text-sm max-w-sm">Connect your email and sync to load arXiv digest emails.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto main-scroll bg-slate-50">
      {/* ── Page header with tabs ── */}
      <div className="bg-white border-b border-slate-200 px-8 pt-6 pb-0">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Research Feed</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Latest papers from every source you follow
                {stats && (
                  <span className="text-slate-400">
                    {' · '}
                    {(stats.total - readIds.size).toLocaleString()} unread
                    {' · '}{stats.saved.toLocaleString()} saved
                  </span>
                )}
              </p>
            </div>
            {/* Tab bar */}
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
              {TABS.map(t => (
                <button
                  key={t.value}
                  onClick={() => setTab(t.value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    tab === t.value ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Tab content ── */}
      {tab === 'feed' && <FeedTab />}
      {tab === 'authors' && <AuthorsTab papers={papers} setSelectedPaper={setSelectedPaper} />}
      {tab === 'conferences' && <ConferencesTab papers={papers} setSelectedPaper={setSelectedPaper} />}
    </div>
  );
}

// =========================================================================
// Feed tab — a flat, chronological stream of incoming papers
// =========================================================================

const LOCAL_COMMENTS_KEY = 'arxiv_paper_comments';

type CommentMap = Record<string, PaperComment[]>;

function readLocalCommentMap(): CommentMap {
  try {
    const raw = localStorage.getItem(LOCAL_COMMENTS_KEY);
    const parsed = raw ? JSON.parse(raw) as CommentMap : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalCommentMap(map: CommentMap) {
  try {
    localStorage.setItem(LOCAL_COMMENTS_KEY, JSON.stringify(map));
  } catch {
    /* storage full or unavailable — comments simply won't persist */
  }
}

function localCommentsFor(paperId: string): PaperComment[] {
  return readLocalCommentMap()[paperId] ?? [];
}

function FeedTab() {
  const { papers, stats, readIds, setSelectedPaper, markRead, markUnread, storageMode } = usePapers();
  const {
    isLiked, likePaper, unlikePaper, isSaved, savePaper, unsavePaper,
    likedCount, savedCount,
  } = useLibrary();

  const [filter, setFilter] = useState<FeedFilter>('all');
  const [category, setCategory] = useState('');
  const [expandedAbstract, setExpandedAbstract] = useState<Set<string>>(new Set());
  const [openComments, setOpenComments] = useState<Set<string>>(new Set());
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});

  const sorted = useMemo(
    () => [...papers].sort((a, b) => b.digestDate.getTime() - a.digestDate.getTime()),
    [papers],
  );

  const catCounts = useMemo<Array<[string, number]>>(() => {
    // Server mode: counts cover the whole library, not just the loaded window.
    if (stats?.categories.length) return stats.categories.map(c => [c.category, c.count]);
    const counts: Record<string, number> = {};
    for (const p of sorted) for (const c of p.categories) counts[c] = (counts[c] ?? 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [sorted, stats]);

  const filtered = useMemo(() => {
    let result = sorted;
    if (category) result = result.filter(p => p.categories.includes(category));
    if (filter === 'unread') result = result.filter(p => !readIds.has(p.id));
    if (filter === 'liked') result = result.filter(p => isLiked(p.id));
    if (filter === 'saved') result = result.filter(p => isSaved(p.id));
    return result;
  }, [sorted, category, filter, readIds, isLiked, isSaved]);

  const pagination = usePagination(filtered, 25);
  const pageKey = pagination.slice.map(p => p.id).join(',');

  // Companies/labs come from each paper's PDF, which the server reads in the
  // background. Poll the visible page while some are still pending.
  const [orgMap, setOrgMap] = useState<Record<string, string | null>>({});
  const [orgTick, setOrgTick] = useState(0);
  const orgPolls = useRef(0);
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
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [pageKey, storageMode, orgTick]);

  useEffect(() => {
    if (!pageKey) return;
    let cancelled = false;
    const ids = pageKey.split(',');
    if (storageMode === 'server') {
      apiGetCommentCounts(ids)
        .then(counts => {
          if (!cancelled) setCommentCounts(prev => ({ ...prev, ...counts }));
        })
        .catch(e => console.warn('[feed] comment counts failed', e));
    } else {
      const map = readLocalCommentMap();
      const next: Record<string, number> = {};
      for (const id of ids) next[id] = (map[id] ?? []).length;
      setCommentCounts(prev => ({ ...prev, ...next }));
    }
    return () => { cancelled = true; };
  }, [pageKey, storageMode]);

  const total = stats?.total ?? papers.length;
  const unreadTotal = storageMode === 'server' && stats
    ? Math.max(0, stats.total - readIds.size)
    : sorted.filter(p => !readIds.has(p.id)).length;

  const filters: Array<{ value: FeedFilter; label: string; count: number }> = [
    { value: 'all',    label: 'All',    count: total },
    { value: 'unread', label: 'Unread', count: unreadTotal },
    { value: 'liked',  label: 'Liked',  count: likedCount },
    { value: 'saved',  label: 'Saved',  count: savedCount },
  ];

  const toggleAbstract = (id: string) => setExpandedAbstract(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleComments = (id: string) => setOpenComments(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="max-w-[640px] mx-auto px-4 py-6">
      {/* Filter tabs */}
      <div className="flex items-end gap-5 border-b border-slate-200 mb-2">
        {filters.map(f => {
          const active = filter === f.value;
          return (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`relative pb-2.5 text-[13px] font-medium transition-colors ${
                active ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {f.label}
              <span className="ml-1.5 text-[11px] tabular-nums text-slate-400">{f.count.toLocaleString()}</span>
              {active && <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-slate-900 rounded-full" />}
            </button>
          );
        })}
      </div>

      {/* Category filter */}
      {catCounts.length > 0 && (
        <div className="flex items-center gap-3 overflow-x-auto hide-scrollbar py-3 text-[12px]">
          <button
            onClick={() => setCategory('')}
            className={`shrink-0 ${!category ? 'text-slate-900 font-semibold' : 'text-slate-400 hover:text-slate-600'}`}
          >
            Everything
          </button>
          {catCounts.slice(0, 16).map(([cat]) => {
            const active = category === cat;
            return (
              <button
                key={cat}
                onClick={() => setCategory(active ? '' : cat)}
                className={`shrink-0 font-mono ${active ? 'text-slate-900 font-semibold underline underline-offset-4 decoration-2' : 'text-slate-400 hover:text-slate-600'}`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      )}

      {/* Stream */}
      {filtered.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-[13px] text-slate-400">
            {filter === 'unread' ? 'Nothing unread. You are caught up.'
              : filter === 'liked' ? 'No liked papers yet.'
              : filter === 'saved' ? 'Nothing saved yet.'
              : 'No papers match this filter.'}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-200 border-t border-slate-200">
          {pagination.slice.map(paper => {
            const pub = publisherOf(paper);
            const read = readIds.has(paper.id);
            const liked = isLiked(paper.id);
            const saved = isSaved(paper.id);
            const expanded = expandedAbstract.has(paper.id);
            const showingComments = openComments.has(paper.id);
            const comments = commentCounts[paper.id] ?? 0;
            const abstract = paper.abstract?.trim() ?? '';
            const longAbstract = abstract.length > 280;
            const openHref = paper.url || (paper.arxivId ? `https://arxiv.org/abs/${paper.arxivId}` : '');
            // The company/lab is the headline when we know it; the venue
            // (arXiv, OpenReview, …) moves to a small "via" note.
            const org = orgMap[paper.id] !== undefined ? orgMap[paper.id] : (paper.organization ?? null);
            const headline = org ?? pub.name;
            const handle = headline.toLowerCase().replace(/[^a-z0-9]+/g, '');

            return (
              <article key={paper.id} className="group relative py-5 pl-5 pr-1 hover:bg-slate-50/70 transition-colors">
                {/* Unread marker */}
                {!read && <span className="absolute left-1.5 top-7 w-1.5 h-1.5 rounded-full bg-blue-500" title="Unread" />}

                {/* Header: publisher as handle */}
                <header className="flex items-baseline gap-2 text-[13px]">
                  <span className="font-semibold text-slate-900">{headline}</span>
                  <span className="text-slate-400 truncate">@{handle || 'source'}</span>
                  <span className="text-slate-300">·</span>
                  <time
                    dateTime={paper.digestDate.toISOString()}
                    title={format(paper.digestDate, 'PPpp')}
                    className="text-slate-400 whitespace-nowrap"
                  >
                    {formatDistanceToNow(paper.digestDate, { addSuffix: false })}
                  </time>
                  {(org || paper.arxivId) && (
                    <span className="ml-auto flex items-baseline gap-2 font-mono text-[11px] text-slate-400 shrink-0">
                      {org && <span className="font-sans">via {pub.name}</span>}
                      {paper.arxivId && <span>{paper.arxivId}</span>}
                    </span>
                  )}
                </header>

                {/* Title + authors */}
                <button
                  onClick={() => { markRead(paper.id); setSelectedPaper(paper); }}
                  className="block text-left mt-1.5 w-full"
                >
                  <h3 className={`text-[16px] leading-snug group-hover:underline decoration-slate-300 underline-offset-2 ${
                    read ? 'font-medium text-slate-700' : 'font-semibold text-slate-900'
                  }`}>
                    {paper.title}
                  </h3>
                </button>
                <p className="mt-0.5 text-[12.5px] text-slate-500 truncate">
                  {paper.authors || paper.authorList.join(', ')}
                </p>

                {/* Abstract */}
                {abstract ? (
                  <div className="mt-2.5">
                    <p className={`text-[14px] leading-[1.65] text-slate-600 ${expanded ? '' : 'line-clamp-3'}`}>
                      {abstract}
                    </p>
                    {longAbstract && (
                      <button
                        onClick={() => toggleAbstract(paper.id)}
                        className="mt-1 text-[12px] font-medium text-slate-500 hover:text-slate-900"
                      >
                        {expanded ? 'Show less' : 'Show more'}
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="mt-2.5 text-[12.5px] text-slate-400">No abstract yet. Open the paper to fetch it.</p>
                )}

                {paper.categories.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-slate-400">
                    {paper.categories.slice(0, 5).map(cat => <span key={cat}>{cat}</span>)}
                  </div>
                )}

                {/* Actions */}
                <div className="mt-3 flex items-center gap-6 text-[12px] text-slate-400">
                  <button
                    onClick={() => (liked ? unlikePaper(paper.id) : likePaper(paper))}
                    className={`flex items-center gap-1.5 transition-colors ${liked ? 'text-rose-600' : 'hover:text-rose-600'}`}
                    title={liked ? 'Unlike' : 'Like'}
                  >
                    <Heart size={15} className={liked ? 'fill-current' : ''} />
                    <span className="tabular-nums">{liked ? 'Liked' : 'Like'}</span>
                  </button>
                  <button
                    onClick={() => toggleComments(paper.id)}
                    className={`flex items-center gap-1.5 transition-colors ${showingComments ? 'text-sky-600' : 'hover:text-sky-600'}`}
                    title="Comments"
                  >
                    <MessageCircle size={15} />
                    <span className="tabular-nums">{comments > 0 ? comments : 'Comment'}</span>
                  </button>
                  <button
                    onClick={() => (saved ? unsavePaper(paper.id) : savePaper(paper))}
                    className={`flex items-center gap-1.5 transition-colors ${saved ? 'text-amber-600' : 'hover:text-amber-600'}`}
                    title={saved ? 'Remove from library' : 'Save to library'}
                  >
                    {saved ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
                    <span>{saved ? 'Saved' : 'Save'}</span>
                  </button>
                  <div className="ml-auto flex items-center gap-4">
                    <button
                      onClick={() => (read ? markUnread(paper.id) : markRead(paper.id))}
                      className="hover:text-slate-700"
                      title={read ? 'Mark as unread' : 'Mark as read'}
                    >
                      {read ? 'Mark unread' : 'Mark read'}
                    </button>
                    {openHref && (
                      <a
                        href={openHref}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => markRead(paper.id)}
                        className="flex items-center gap-1 hover:text-slate-700"
                        title={`Open on ${pub.name}`}
                      >
                        <ExternalLink size={13} />
                        <span>Open</span>
                      </a>
                    )}
                  </div>
                </div>

                {showingComments && (
                  <CommentThread
                    paperId={paper.id}
                    onCountChange={(n) => setCommentCounts(prev => ({ ...prev, [paper.id]: n }))}
                  />
                )}
              </article>
            );
          })}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="mt-6">
          <Pager pagination={pagination} variant="light" size="sm" label="papers" pageSizes={[25, 50, 100]} />
        </div>
      )}
    </div>
  );
}

// =========================================================================
// Comment thread — a user's own notes on a paper
// =========================================================================

function CommentThread({ paperId, onCountChange }: {
  paperId: string;
  onCountChange: (n: number) => void;
}) {
  const { storageMode } = usePapers();
  const [comments, setComments] = useState<PaperComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const list = storageMode === 'server'
          ? await apiGetPaperComments(paperId)
          : localCommentsFor(paperId);
        if (cancelled) return;
        setComments(list);
        onCountChange(list.length);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load comments');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [paperId, storageMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError('');
    try {
      let created: PaperComment;
      if (storageMode === 'server') {
        created = await apiAddPaperComment(paperId, text);
      } else {
        created = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          paperId,
          body: text,
          createdAt: Date.now(),
        };
        const map = readLocalCommentMap();
        map[paperId] = [...(map[paperId] ?? []), created];
        writeLocalCommentMap(map);
      }
      const next = [...comments, created];
      setComments(next);
      onCountChange(next.length);
      setBody('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post the comment');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setError('');
    try {
      if (storageMode === 'server') {
        await apiDeletePaperComment(id);
      } else {
        const map = readLocalCommentMap();
        map[paperId] = (map[paperId] ?? []).filter(c => c.id !== id);
        writeLocalCommentMap(map);
      }
      const next = comments.filter(c => c.id !== id);
      setComments(next);
      onCountChange(next.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the comment');
    }
  };

  return (
    <div className="mt-4 pl-4 border-l-2 border-slate-200 space-y-3">
      {loading ? (
        <p className="text-[12px] text-slate-400 flex items-center gap-2">
          <Loader2 size={12} className="animate-spin" /> Loading
        </p>
      ) : comments.length === 0 ? (
        <p className="text-[12px] text-slate-400">No notes yet.</p>
      ) : (
        comments.map(c => (
          <div key={c.id} className="group/c">
            <p className="text-[13px] leading-relaxed text-slate-700 whitespace-pre-wrap break-words">{c.body}</p>
            <div className="mt-0.5 flex items-center gap-3 text-[11px] text-slate-400">
              <span>{formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}</span>
              <button onClick={() => remove(c.id)} className="opacity-0 group-hover/c:opacity-100 hover:text-rose-600 transition-opacity">
                Delete
              </button>
            </div>
          </div>
        ))
      )}

      <div className="flex items-end gap-2">
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={2}
          maxLength={4000}
          placeholder="Add a note"
          className="flex-1 resize-none bg-transparent border-b border-slate-300 focus:border-slate-900 text-[13px] text-slate-800 placeholder:text-slate-400 py-1.5 focus:outline-none"
        />
        <button
          onClick={() => void submit()}
          disabled={busy || !body.trim()}
          className="text-[12px] font-semibold text-slate-900 disabled:text-slate-300 pb-1.5"
        >
          {busy ? 'Posting…' : 'Post'}
        </button>
      </div>
      <p className="text-[10.5px] text-slate-400">⌘/Ctrl + Enter to post</p>

      {error && <p className="text-[11px] text-rose-600">{error}</p>}
    </div>
  );
}

// =========================================================================
// Authors tab — top authors with featured researchers + pagination
// =========================================================================

function AuthorsTab({ papers, setSelectedPaper }: {
  papers: ReturnType<typeof usePapers>['papers'];
  setSelectedPaper: (p: ReturnType<typeof usePapers>['papers'][0]) => void;
}) {
  const [query, setQuery] = useState('');
  const [selectedAuthor, setSelectedAuthor] = useState<AuthorStat | null>(null);

  const allStats = useMemo(() => computeAuthorStats(papers), [papers]);

  // Featured authors found in the user's papers (matched by name)
  const featuredFound = useMemo(() => {
    return FEATURED_AUTHORS.map(fa => {
      // Match case-insensitively against the authorList of every paper
      const matchName = fa.matchName.toLowerCase();
      const authorStat = allStats.find(a => a.name.toLowerCase().includes(matchName));
      return authorStat ? { featured: fa, stat: authorStat } : null;
    }).filter(Boolean) as Array<{ featured: typeof FEATURED_AUTHORS[0]; stat: AuthorStat }>;
  }, [allStats]);

  const filtered = useMemo(() => {
    const min = 5; // only authors with 5+ papers
    let result = allStats.filter(a => a.paperCount >= min);
    if (query) {
      const q = query.toLowerCase();
      result = result.filter(a => a.name.toLowerCase().includes(q));
    }
    return result;
  }, [allStats, query]);

  // ── Author detail ──
  if (selectedAuthor) {
    const authorPapers = selectedAuthor.papers.slice().sort((a, b) => b.digestDate.getTime() - a.digestDate.getTime());
    return (
      <div className="max-w-5xl mx-auto px-8 py-6 fade-in">
        <button
          onClick={() => setSelectedAuthor(null)}
          className="text-xs text-slate-500 hover:text-slate-700 mb-4 flex items-center gap-1 transition-colors"
        >
          <ChevronRight size={12} className="rotate-180" /> All authors
        </button>
        <div className="flex items-start gap-4 mb-6">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-lg font-bold shrink-0 shadow-md">
            {selectedAuthor.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">{selectedAuthor.name}</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {selectedAuthor.paperCount} papers · {selectedAuthor.categories.length} categories · last seen {format(selectedAuthor.lastDate, 'MMM yyyy')}
            </p>
            <div className="flex flex-wrap gap-1 mt-2">
              {selectedAuthor.categories.slice(0, 8).map(cat => {
                const color = CATEGORY_COLORS_LIGHT[cat] ?? CATEGORY_COLORS_LIGHT.default;
                return <span key={cat} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${color}`}>{cat}</span>;
              })}
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {authorPapers.map(paper => {
            const assessment = computeAssessment(paper);
            return (
              <button
                key={paper.id}
                onClick={() => setSelectedPaper(paper)}
                className={`w-full text-left px-5 py-3.5 flex items-start gap-4 hover:bg-slate-50 transition-colors group border-b border-slate-100 last:border-0`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 line-clamp-1 group-hover:text-blue-700 transition-colors">{paper.title}</p>
                  <p className="text-xs text-slate-400 mt-1 truncate">
                    {format(paper.digestDate, 'MMM d, yyyy')} · {paper.arxivId}
                  </p>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-1 rounded-full border shrink-0 ${ASSESSMENT_BADGE[assessment.label]}`}>
                  {assessment.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Author list ──
  return (
    <div className="max-w-5xl mx-auto px-8 py-6 fade-in">
      {/* Featured AI researchers */}
      {featuredFound.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Award size={16} className="text-amber-500" />
            <h2 className="text-sm font-bold text-slate-700">Featured Researchers in Your Library</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {featuredFound.map(({ featured, stat }) => (
              <button
                key={featured.name}
                onClick={() => setSelectedAuthor(stat)}
                className="text-left bg-white rounded-xl border border-slate-200 p-4 hover:border-indigo-300 hover:shadow-md transition-all group"
              >
                <div className="flex items-start gap-3 mb-3">
                  <img
                    src={featured.photoUrl}
                    alt={featured.name}
                    className="w-12 h-12 rounded-full object-cover shrink-0 border border-slate-200"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 group-hover:text-indigo-700 transition-colors truncate">{featured.name}</p>
                    <p className="text-[10px] text-slate-400 truncate">{featured.affiliation}</p>
                  </div>
                </div>
                <p className="text-[10px] font-semibold text-indigo-600 mb-1">{featured.title}</p>
                <p className="text-[11px] text-slate-500 line-clamp-3 leading-relaxed">{featured.bio}</p>
                <p className="text-[10px] text-slate-400 mt-2 pt-2 border-t border-slate-100">
                  {stat.paperCount} papers in your library →
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* All authors header */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500">
          {filtered.length} author{filtered.length !== 1 ? 's' : ''} with 5+ papers
        </p>
        <div className="relative w-64">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search authors…"
            className="w-full pl-3 pr-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-all"
          />
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="text-center text-slate-400 text-sm py-12">
          {allStats.length === 0 ? 'No authors found.' : 'No authors with 5+ papers yet.'}
        </p>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <AuthorList items={filtered} onSelect={setSelectedAuthor} />
        </div>
      )}
    </div>
  );
}

// Author list with pagination — keeps the DOM light even with 10k+ authors
function AuthorList({ items, onSelect }: {
  items: AuthorStat[];
  onSelect: (a: AuthorStat) => void;
}) {
  const pager = usePagination(items, 50);
  return (
    <>
      {pager.slice.map((author, idx) => {
        const rank = pager.rangeStart + idx;
        return (
          <button
            key={author.name}
            onClick={() => onSelect(author)}
            className={`w-full text-left px-5 py-3.5 flex items-center gap-4 hover:bg-slate-50 transition-colors group border-b border-slate-100 last:border-0`}
          >
            {/* Rank */}
            <span className="text-[10px] font-bold text-slate-400 w-6 shrink-0 text-right">{rank}</span>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0 ${
              rank <= 3 ? 'bg-gradient-to-br from-indigo-500 to-violet-500' : 'bg-slate-400'
            }`}>
              {author.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800 group-hover:text-indigo-700 transition-colors truncate">{author.name}</p>
              <p className="text-xs text-slate-400 truncate">
                {author.paperCount} papers · {author.categories.slice(0, 3).join(', ')}
                {author.categories.length > 3 && ` +${author.categories.length - 3}`}
              </p>
            </div>
            <span className="text-xs font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded-full shrink-0">
              {author.paperCount}
            </span>
            <ChevronRight size={14} className="text-slate-300 group-hover:text-indigo-500 transition-colors shrink-0" />
          </button>
        );
      })}
      <Pager pagination={pager} variant="light" size="sm" label="authors" pageSizes={[25, 50, 100, 250]} />
    </>
  );
}

// =========================================================================
// Conferences tab — venue list with descriptions + pagination, papers
// inside each venue sortable by year with ranking
// =========================================================================

type ConfSortMode = 'papers' | 'name' | 'recent';

function ConferencesTab({ papers, setSelectedPaper }: {
  papers: ReturnType<typeof usePapers>['papers'];
  setSelectedPaper: (p: ReturnType<typeof usePapers>['papers'][0]) => void;
}) {
  const [selectedVenue, setSelectedVenue] = useState<VenueGroup | null>(null);
  const [sortMode, setSortMode] = useState<ConfSortMode>('papers');

  const allGroups = useMemo(() => groupByVenue(papers), [papers]);
  const allVenuePapers = useMemo(() => papers.filter(p => detectVenue(p) !== null), [papers]);

  const sortedGroups = useMemo(() => {
    const result = [...allGroups];
    if (sortMode === 'papers') {
      result.sort((a, b) => b.papers.length - a.papers.length || a.info.name.localeCompare(b.info.name));
    } else if (sortMode === 'name') {
      result.sort((a, b) => a.info.name.localeCompare(b.info.name));
    } else {
      // recent: most recent paper date first
      result.sort((a, b) => {
        const aLast = Math.max(...a.papers.map(p => p.digestDate.getTime()));
        const bLast = Math.max(...b.papers.map(p => p.digestDate.getTime()));
        return bLast - aLast;
      });
    }
    return result;
  }, [allGroups, sortMode]);

  // ── Venue detail ──
  if (selectedVenue) {
    return (
      <VenueDetail venue={selectedVenue} setSelectedPaper={setSelectedPaper} onBack={() => setSelectedVenue(null)} />
    );
  }

  // ── Venue list ──
  return (
    <div className="max-w-5xl mx-auto px-8 py-6 fade-in">
      {/* Intro */}
      <div className="mb-6">
        <p className="text-sm text-slate-600 leading-relaxed">
          Conference and venue information is automatically detected from the arXiv <code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded">comments</code> field
          of each paper — for example "Accepted at NeurIPS 2024" or "Published in CVPR 2024".
          Papers without venue metadata won't appear here.
        </p>
        <p className="text-sm text-slate-500 mt-2">
          {allVenuePapers.length.toLocaleString()} of {papers.length.toLocaleString()} papers have a detected venue · {allGroups.length} venue{allGroups.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Sort bar */}
      <div className="flex items-center gap-2 mb-4">
        <ArrowUpDown size={13} className="text-slate-400" />
        <span className="text-xs text-slate-500 mr-1">Sort:</span>
        {([
          { value: 'papers', label: 'Most papers' },
          { value: 'name',   label: 'A-Z' },
          { value: 'recent', label: 'Most recent' },
        ] as const).map(opt => (
          <button
            key={opt.value}
            onClick={() => setSortMode(opt.value)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
              sortMode === opt.value
                ? 'bg-slate-800 text-white'
                : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300 hover:text-slate-700'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {allGroups.length === 0 ? (
        <div className="text-center py-12">
          <Presentation size={32} className="mx-auto text-slate-300 mb-3" />
          <p className="text-slate-400 text-sm">
            No conference papers detected. Venue info is parsed from the arXiv "comments" field.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <VenueList items={sortedGroups} onSelect={setSelectedVenue} />
        </div>
      )}
    </div>
  );
}

// Venue list with pagination
function VenueList({ items, onSelect }: {
  items: VenueGroup[];
  onSelect: (v: VenueGroup) => void;
}) {
  const pager = usePagination(items, 20);
  return (
    <>
      {pager.slice.map((group, idx) => {
        const rank = pager.rangeStart + idx;
        const recentPaper = group.papers.slice().sort((a, b) => b.digestDate.getTime() - a.digestDate.getTime())[0];
        return (
          <button
            key={group.info.key}
            onClick={() => onSelect(group)}
            className={`w-full text-left px-5 py-4 flex items-start gap-4 hover:bg-slate-50 transition-colors group border-b border-slate-100 last:border-0`}
          >
            {/* Rank */}
            <span className="text-[10px] font-bold text-slate-400 w-6 shrink-0 text-right mt-1">{rank}</span>
            {/* Icon */}
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0 shadow-sm mt-0.5 ${
              group.info.type === 'conference' ? 'bg-gradient-to-br from-emerald-500 to-teal-500' :
              group.info.type === 'workshop'   ? 'bg-gradient-to-br from-amber-500 to-orange-500' :
                                                  'bg-gradient-to-br from-blue-500 to-cyan-500'
            }`}>
              {group.info.type === 'conference' ? <Presentation size={16} /> :
               group.info.type === 'workshop'   ? <Users size={16} /> :
                                                   <BookOpen size={16} />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-800 group-hover:text-emerald-700 transition-colors">{group.info.name}</p>
                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                  group.info.type === 'conference' ? 'bg-emerald-100 text-emerald-700' :
                  group.info.type === 'workshop'   ? 'bg-amber-100 text-amber-700' :
                                                      'bg-blue-100 text-blue-700'
                }`}>
                  {group.info.type}
                </span>
              </div>
              {/* Description */}
              <p className="text-[11px] text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                {group.info.about}
              </p>
              <p className="text-xs text-slate-400 mt-1.5">
                {group.papers.length} paper{group.papers.length !== 1 ? 's' : ''}
                {group.years.length > 0 && ` · ${group.years.join(', ')}`}
                {recentPaper && ` · latest ${format(recentPaper.digestDate, 'MMM yyyy')}`}
              </p>
            </div>
            <span className="text-xs font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded-full shrink-0 mt-1">
              {group.papers.length}
            </span>
            <ChevronRight size={14} className="text-slate-300 group-hover:text-emerald-500 transition-colors shrink-0 mt-1.5" />
          </button>
        );
      })}
      <Pager pagination={pager} variant="light" size="sm" label="venues" pageSizes={[10, 20, 50]} />
    </>
  );
}

// Venue detail — papers grouped by year with per-year rankings
function VenueDetail({ venue, setSelectedPaper, onBack }: {
  venue: VenueGroup;
  setSelectedPaper: (p: Paper) => void;
  onBack: () => void;
}) {
  const [yearFilter, setYearFilter] = useState<number | 'all'>('all');

  // Group papers by year (extracted from venue detection), sort years desc
  const byYear = useMemo(() => {
    const map = new Map<number, Paper[]>();
    const noYear: Paper[] = [];
    for (const p of venue.papers) {
      const info = detectVenue(p);
      const yr = info?.year;
      if (yr) {
        const arr = map.get(yr) ?? [];
        arr.push(p);
        map.set(yr, arr);
      } else {
        noYear.push(p);
      }
    }
    // Sort each year's papers by assessment score (depth ranking)
    const sortPapers = (arr: Paper[]) =>
      arr.map(p => ({ p, a: computeAssessment(p) }))
         .sort((x, y) => y.a.score - x.a.score)
         .map(x => x.p);
    const grouped = Array.from(map.entries())
      .map(([year, papers]) => ({ year, papers: sortPapers(papers) }))
      .sort((a, b) => b.year - a.year);
    return { grouped, noYear: sortPapers(noYear) };
  }, [venue]);

  // Years available for the filter dropdown
  const years = byYear.grouped.map(g => g.year);

  // Filtered groups
  const visibleGroups = yearFilter === 'all'
    ? byYear.grouped
    : byYear.grouped.filter(g => g.year === yearFilter);

  return (
    <div className="max-w-5xl mx-auto px-8 py-6 fade-in">
      <button
        onClick={onBack}
        className="text-xs text-slate-500 hover:text-slate-700 mb-4 flex items-center gap-1 transition-colors"
      >
        <ChevronRight size={12} className="rotate-180" /> All venues
      </button>
      {/* Venue header */}
      <div className="flex items-start gap-4 mb-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white shrink-0 shadow-md ${
          venue.info.type === 'conference' ? 'bg-gradient-to-br from-emerald-500 to-teal-500' :
          venue.info.type === 'workshop'   ? 'bg-gradient-to-br from-amber-500 to-orange-500' :
                                              'bg-gradient-to-br from-blue-500 to-cyan-500'
        }`}>
          {venue.info.type === 'conference' ? <Presentation size={20} /> :
           venue.info.type === 'workshop'   ? <Users size={20} /> :
                                               <BookOpen size={20} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900">{venue.info.name}</h2>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              venue.info.type === 'conference' ? 'bg-emerald-100 text-emerald-700' :
              venue.info.type === 'workshop'   ? 'bg-amber-100 text-amber-700' :
                                                  'bg-blue-100 text-blue-700'
            }`}>
              {venue.info.type}
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-0.5 leading-relaxed">{venue.info.about}</p>
          <p className="text-xs text-slate-400 mt-1">
            {venue.papers.length} paper{venue.papers.length !== 1 ? 's' : ''} across {years.length} year{years.length !== 1 ? 's' : ''}
            {years.length > 0 && ` · ${years.join(', ')}`}
          </p>
        </div>
      </div>

      {/* Year filter bar */}
      {years.length > 1 && (
        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1 hide-scrollbar">
          <button
            onClick={() => setYearFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
              yearFilter === 'all'
                ? 'bg-slate-800 text-white'
                : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300 hover:text-slate-700'
            }`}
          >
            All years
            <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
              yearFilter === 'all' ? 'bg-white/20' : 'bg-slate-100'
            }`}>
              {venue.papers.length}
            </span>
          </button>
          {years.map(yr => {
            const count = byYear.grouped.find(g => g.year === yr)?.papers.length ?? 0;
            const active = yearFilter === yr;
            return (
              <button
                key={yr}
                onClick={() => setYearFilter(yr)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  active
                    ? 'bg-slate-800 text-white'
                    : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300 hover:text-slate-700'
                }`}
              >
                {yr}
                <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                  active ? 'bg-white/20' : 'bg-slate-100'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Papers grouped by year with per-year ranking */}
      <div className="space-y-8">
        {visibleGroups.map(group => (
          <YearSection
            key={group.year}
            year={group.year}
            papers={group.papers}
            setSelectedPaper={setSelectedPaper}
          />
        ))}
        {/* Papers with no detected year (only in "all" mode) */}
        {yearFilter === 'all' && byYear.noYear.length > 0 && (
          <YearSection
            year={null}
            papers={byYear.noYear}
            setSelectedPaper={setSelectedPaper}
          />
        )}
        {visibleGroups.length === 0 && byYear.noYear.length === 0 && (
          <p className="text-center text-slate-400 text-sm py-8">No papers for this year.</p>
        )}
      </div>
    </div>
  );
}

// A single year section within a venue detail — papers ranked by depth score
function YearSection({ year, papers, setSelectedPaper }: {
  year: number | null;
  papers: Paper[];
  setSelectedPaper: (p: Paper) => void;
}) {
  const pager = usePagination(papers, 50);
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <div className={`px-3 py-1 rounded-lg text-sm font-bold ${
          year ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-600'
        }`}>
          {year ?? 'Date unknown'}
        </div>
        <span className="text-xs text-slate-400">
          {papers.length} paper{papers.length !== 1 ? 's' : ''} · ranked by depth score
        </span>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {pager.slice.map((paper, idx) => {
          const assessment = computeAssessment(paper);
          const rank = idx + 1; // per-year rank
          return (
            <button
              key={paper.id}
              onClick={() => setSelectedPaper(paper)}
              className={`w-full text-left px-5 py-3.5 flex items-start gap-4 hover:bg-slate-50 transition-colors group border-b border-slate-100 last:border-0`}
            >
              {/* Per-year rank badge */}
              <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 font-bold text-xs ${
                rank === 1 ? 'bg-amber-100 text-amber-700' :
                rank === 2 ? 'bg-slate-100 text-slate-600' :
                rank === 3 ? 'bg-orange-100 text-orange-700' :
                'bg-slate-50 text-slate-400'
              }`}>
                {rank}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 line-clamp-1 group-hover:text-blue-700 transition-colors">{paper.title}</p>
                <p className="text-xs text-slate-400 mt-1 truncate">
                  {paper.authorList[0]}{paper.authorList.length > 1 ? ' et al.' : ''} · {format(paper.digestDate, 'MMM d, yyyy')}
                </p>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-1 rounded-full border shrink-0 ${ASSESSMENT_BADGE[assessment.label]}`}>
                {assessment.label}
              </span>
            </button>
          );
        })}
        <Pager pagination={pager} variant="light" size="sm" label="papers" pageSizes={[25, 50, 100]} />
      </div>
    </section>
  );
}