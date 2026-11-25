import { useState, useEffect, useMemo, useRef } from 'react';
import { usePapers } from '../contexts/PapersContext';
import { useLibrary } from '../contexts/LibraryContext';
import { useAuthors } from '../contexts/AuthorsContext';
import { useTracking } from '../contexts/TrackingContext';
import { publisherOf } from '../utils/publisher';
import {
  apiGetPaperComments, apiAddPaperComment, apiDeletePaperComment, apiGetCommentCounts,
  apiGetOrganizations, apiGetRelevantPapers,
  apiGetTopAuthors, type TopAuthor,
} from '../utils/researchApi';
import { format, formatDistanceToNow } from 'date-fns';
import {
  BookOpen, Heart, Bookmark, BookmarkCheck, MessageCircle,
  ExternalLink, Loader2, RefreshCw, Target, Users, Sparkles, Plus, X,
} from 'lucide-react';
import type { Paper, PaperComment } from '../types';
import FollowingFeed from './FollowingFeed';
import CompanyFeed from './CompanyFeed';
import CompanyTabPicker from './CompanyTabPicker';
import PaperImagePreview from './PaperImagePreview';

const FEED_BATCH_SIZE = 10;

// ---------------------------------------------------------------------------
// Dashboard shell — Twitter-style tabs: "For you", "Following", then any
// company the user pins. Everything lives here; no separate menus needed.
// ---------------------------------------------------------------------------

const COMPANY_TABS_KEY = 'dashboard.companyTabs.v1';
const DEFAULT_PINNED = ['NVIDIA', 'DeepSeek'];

function readPinnedCompanies(): string[] {
  try {
    const raw = localStorage.getItem(COMPANY_TABS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((n): n is string => typeof n === 'string' && n.trim() !== '');
    }
  } catch { /* ignore */ }
  return DEFAULT_PINNED;
}

function writePinnedCompanies(names: string[]) {
  try { localStorage.setItem(COMPANY_TABS_KEY, JSON.stringify(names)); } catch { /* ignore */ }
}

export default function Dashboard({ onOpenAuthors, onOpenCompanies }: {
  onOpenAuthors?: () => void;
  onOpenCompanies?: () => void;
}) {
  const { papers } = usePapers();
  const [pinned, setPinned] = useState<string[]>(readPinnedCompanies);
  // 'foryou' | 'following' | `company:<name>`
  const [active, setActive] = useState('foryou');
  const [pickerOpen, setPickerOpen] = useState(false);

  const togglePin = (name: string) => {
    setPinned(prev => {
      const next = prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name];
      writePinnedCompanies(next);
      if (!next.includes(name) && active === `company:${name}`) setActive('foryou');
      return next;
    });
  };

  if (papers.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center">
        <BookOpen size={28} className="mb-4 text-slate-400" />
        <h2 className="text-xl font-semibold text-slate-700">No papers yet</h2>
        <p className="mt-2 text-sm text-slate-400">Connect your email and sync to load arXiv digest emails.</p>
      </div>
    );
  }

  const activeCompany = active.startsWith('company:') ? active.slice('company:'.length) : null;

  const tabButton = (id: string, label: string, icon?: React.ReactNode, onRemove?: () => void) => {
    const isActive = active === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => setActive(id)}
        className={`group relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3.5 py-3 text-[12.5px] transition-colors ${
          isActive ? 'font-semibold text-slate-900' : 'text-slate-500 hover:bg-slate-900/5 hover:text-slate-800'
        }`}
      >
        {icon}
        {label}
        {onRemove && (
          <span
            role="button"
            tabIndex={0}
            aria-label={`Remove ${label} tab`}
            onClick={e => { e.stopPropagation(); onRemove(); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); onRemove(); } }}
            className="ml-0.5 hidden rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 group-hover:inline-flex"
          >
            <X size={11} />
          </span>
        )}
        {isActive && <span className="absolute bottom-0 left-3 right-3 h-[3px] rounded-full bg-slate-900" />}
      </button>
    );
  };

  return (
    <div className="flex h-full flex-col bg-[#f6f6f3]">
      {/* Fixed header + tab bar; the feed scrolls underneath, Twitter-style. */}
      <div className="shrink-0 border-b border-[#e7e5df] bg-[#f6f6f3]/95 backdrop-blur">
        <div className="mx-auto max-w-[780px] px-5 sm:px-0">
          <p className="pt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Your research desk</p>
          <div className="mt-1 flex items-end overflow-x-auto main-scroll">
            {tabButton('foryou', 'For you', <Sparkles size={13} />)}
            {tabButton('following', 'Following', <Heart size={13} />)}
            {pinned.map(name => tabButton(`company:${name}`, name, undefined, () => togglePin(name)))}
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              title="Add a company tab"
              aria-label="Add a company tab"
              className="mb-1.5 ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#e7e5df] bg-white text-slate-500 transition hover:border-slate-400 hover:text-slate-800"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto main-scroll">
        <div className="mx-auto max-w-[780px] px-5 pb-8 pt-6 sm:px-0">
          {active === 'foryou' && (
            <>
              <h1 className="font-serif text-[32px] leading-none tracking-tight text-slate-900">For you</h1>
              <p className="mb-4 mt-3 text-[13px] text-slate-500">The best matches for your research interests, regardless of publication date.</p>
              <FeedTab onOpenAuthors={onOpenAuthors} />
            </>
          )}
          {active === 'following' && (
            <>
              <h1 className="font-serif text-[32px] leading-none tracking-tight text-slate-900">Following</h1>
              <p className="mb-4 mt-3 text-[13px] text-slate-500">Newest papers from the authors you follow.</p>
              <FollowingFeed onManageAuthors={onOpenAuthors} />
            </>
          )}
          {activeCompany && (
            <>
              <h1 className="font-serif text-[32px] leading-none tracking-tight text-slate-900">{activeCompany}</h1>
              <p className="mb-4 mt-3 text-[13px] text-slate-500">
                Papers from {activeCompany} — in your library and on Hugging Face.
              </p>
              <CompanyFeed company={activeCompany} />
            </>
          )}
        </div>
      </div>

      {pickerOpen && (
        <CompanyTabPicker
          pinned={pinned}
          onToggle={togglePin}
          onClose={() => setPickerOpen(false)}
          onOpenDirectory={onOpenCompanies ? () => { setPickerOpen(false); onOpenCompanies(); } : undefined}
        />
      )}
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

function FeedTab({ onOpenAuthors }: { onOpenAuthors?: () => void }) {
  const {
    papers, readIds, setSelectedPaper, markRead, markUnread, storageMode, updatePaperMeta,
  } = usePapers();
  const { isLiked, likePaper, unlikePaper, isSaved, savePaper, unsavePaper, likedPapers, savedPapers, likedCount, savedCount } = useLibrary();
  const { favouriteAuthors } = useAuthors();
  const { trackers, scores, ready: trackersReady } = useTracking();
  const [page, setPage] = useState(0);
  const [feed, setFeed] = useState<{ papers: Paper[]; total: number }>({ papers: [], total: 0 });
  const [authorFilter, setAuthorFilter] = useState<{ key: string; name: string } | null>(null);
  const [serverTopAuthors, setServerTopAuthors] = useState<TopAuthor[]>([]);
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
          score: score.score,
          source: 'tracker',
          trackerName: tracker.name,
          rationale: score.rationale,
        });
      }
    }

    // Author affinity: papers by authors of liked/saved papers, mirroring the
    // server-side ranking.
    const favourites = [...new Map([...likedPapers, ...savedPapers].map(p => [p.id, p])).values()];
    const favouriteIds = new Set(favourites.map(p => p.id));
    const authorWeights = new Map<string, number>();
    for (const paper of favourites) {
      for (const author of paper.authorList) {
        const key = author.trim().toLowerCase();
        if (key) authorWeights.set(key, (authorWeights.get(key) ?? 0) + 1);
      }
    }
    // Explicitly followed authors get the same boost as the server feed.
    for (const author of favouriteAuthors) {
      authorWeights.set(author.key, (authorWeights.get(author.key) ?? 0) + 3);
    }
    if (authorWeights.size > 0) {
      for (const paper of papers) {
        if (favouriteIds.has(paper.id) || best.has(paper.id)) continue;
        let shared = 0;
        let weight = 0;
        let sample: string | null = null;
        for (const author of paper.authorList) {
          const w = authorWeights.get(author.trim().toLowerCase()) ?? 0;
          // Only authors recurring on two or more favourites, matching the
          // server-side `strong_authors` threshold.
          if (w >= 2) {
            shared += 1;
            weight += w;
            sample = sample ?? author;
          }
        }
        if (shared > 0) {
          best.set(paper.id, {
            score: Math.min(95, 50 + shared * 6 + Math.min(25, weight * 2)),
            source: 'author',
            authorName: sample ?? undefined,
            rationale: '',
          });
        }
      }
    }

    return papers.filter(p => best.has(p.id))
      .map(p => ({ ...p, relevance: best.get(p.id)! }))
      .sort((a, b) => b.relevance!.score - a.relevance!.score
        || b.digestDate.getTime() - a.digestDate.getTime());
  }, [papers, trackers, scores, likedPapers, savedPapers, favouriteAuthors]);

  // Authors ranked by how many liked/saved papers they appear on. In server
  // mode the full library is not in memory, so ask the API instead.
  const localTopAuthors = useMemo<TopAuthor[]>(() => {
    const favourites = [...new Map([...likedPapers, ...savedPapers].map(p => [p.id, p])).values()];
    const byKey = new Map<string, TopAuthor>();
    for (const paper of favourites) {
      for (const author of paper.authorList) {
        const name = author.trim();
        const key = name.toLowerCase();
        if (!key) continue;
        const entry = byKey.get(key);
        if (entry) entry.count += 1;
        else byKey.set(key, { key, name, count: 1 });
      }
    }
    return [...byKey.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 12);
  }, [likedPapers, savedPapers]);
  const topAuthors = storageMode === 'server' ? serverTopAuthors : localTopAuthors;

  useEffect(() => {
    if (storageMode !== 'server') return;
    let cancelled = false;
    apiGetTopAuthors(12)
      .then(list => { if (!cancelled) setServerTopAuthors(list); })
      .catch(e => console.warn('[feed] top authors failed', e));
    return () => { cancelled = true; };
  }, [storageMode, likedCount, savedCount]);

  const toggleAuthor = (author: TopAuthor) => {
    setAuthorFilter(current => current?.key === author.key ? null : { key: author.key, name: author.name });
    setPage(0);
  };

  useEffect(() => { setPage(0); }, [storageMode, trackersReady]);
  useEffect(() => {
    if (storageMode !== 'server') {
      const list = authorFilter
        ? papers
            .filter(p => p.authorList.some(a => a.trim().toLowerCase() === authorFilter.key))
            .sort((a, b) => b.digestDate.getTime() - a.digestDate.getTime())
        : localMatches;
      setFeed({ papers: list.slice(page * FEED_BATCH_SIZE, (page + 1) * FEED_BATCH_SIZE), total: list.length });
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    apiGetRelevantPapers({
      limit: FEED_BATCH_SIZE,
      offset: page * FEED_BATCH_SIZE,
      author: authorFilter?.key ?? '',
    })
      .then(result => {
        if (cancelled) return;
        if (result.papers.length === 0 && page > 0) setPage(0);
        else setFeed(result);
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load your feed.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [storageMode, localMatches, papers, page, trackersReady, authorFilter]);

  const displayedPapers = feed.papers.slice(0, FEED_BATCH_SIZE);
  const pageKey = displayedPapers.map(p => p.id).join(',');
  const total = feed.total;
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
    <div>
      <section className="mt-6 rounded-xl border border-[#e7e5df] bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              <Users size={12} /> Top authors
            </h2>
            <p className="mt-1 text-[11px] text-slate-500">From papers you liked or saved</p>
          </div>
          {authorFilter && (
            <button
              type="button"
              onClick={() => { setAuthorFilter(null); setPage(0); }}
              className="text-[11px] font-medium text-sky-700 hover:underline"
            >
              Clear filter
            </button>
          )}
          {onOpenAuthors && (
            <button
              type="button"
              onClick={onOpenAuthors}
              className="text-[11px] font-medium text-slate-500 transition-colors hover:text-slate-900"
            >
              View all →
            </button>
          )}
        </div>
        {topAuthors.length === 0 ? (
          <p className="mt-3 text-[11px] text-slate-400">
            Like or save a few papers and their authors will appear here.
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {topAuthors.map(author => {
              const active = authorFilter?.key === author.key;
              return (
                <button
                  key={author.key}
                  type="button"
                  onClick={() => toggleAuthor(author)}
                  title={`${author.count} liked or saved paper${author.count === 1 ? '' : 's'}`}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                    active
                      ? 'border-amber-300 bg-amber-50 text-amber-800'
                      : 'border-[#e7e5df] bg-white text-slate-600 hover:border-amber-300 hover:text-amber-800'
                  }`}
                >
                  {author.name}
                  <span className={`rounded-full px-1 text-[9px] font-semibold ${
                    active ? 'bg-amber-200 text-amber-900' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {author.count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-6">
      <div className="mb-3 flex items-center justify-between gap-4">
        <p className="text-[12px] text-slate-500">
          {authorFilter
            ? <>Papers by <span className="font-medium text-slate-700">{authorFilter.name}</span>{total > 0 ? ` · ${total.toLocaleString()}` : ''}</>
            : total > 0 ? `${total.toLocaleString()} papers matched to your interests` : 'Papers matched to your interests'}
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
            {authorFilter
              ? `No papers by ${authorFilter.name} in your library.`
              : enabledTrackers.length === 0 ? 'Set up a research interest to personalize your feed.' : 'No papers currently match your trackers or favourite authors.'}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-[12px] leading-relaxed text-slate-500">
            {authorFilter
              ? 'Clear the author filter to return to your full feed.'
              : enabledTrackers.length === 0
                ? 'Create and enable a tracker. Existing papers will be ranked by interest, not just by how new they are.'
                : 'You can lower a tracker’s minimum score, or like/save papers so their authors show up in your feed.'}
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
                      paper.relevance.source === 'author' ? (
                        <span
                          className="ml-auto inline-flex items-center gap-1 font-medium text-amber-700"
                          title={`Shares an author with papers you liked or saved${paper.relevance.authorName ? ` — ${paper.relevance.authorName}` : ''}`}
                        >
                          <Heart size={11} /> Favourite author{paper.relevance.authorName ? ` · ${paper.relevance.authorName}` : ''}
                        </span>
                      ) : (
                        <span className="ml-auto inline-flex items-center gap-1 font-medium text-sky-700" title={paper.relevance.rationale}>
                          <Target size={11} /> {paper.relevance.score} · {paper.relevance.trackerName}
                        </span>
                      )
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
