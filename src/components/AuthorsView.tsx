import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  ArrowLeft, Heart, Library, Loader2, Search, Sparkles, UserPlus, Users,
} from 'lucide-react';
import { useAuthors } from '../contexts/AuthorsContext';
import { useLibrary } from '../contexts/LibraryContext';
import { usePapers } from '../contexts/PapersContext';
import {
  apiGetAllAuthors, apiGetAuthorPapers, apiGetTopAuthors,
  type AuthorRef, type DirectoryAuthor, type TopAuthor,
} from '../utils/researchApi';
import type { Paper } from '../types';

type Tab = 'top' | 'following' | 'all';

const PAGE = 24;
const TOP_LIMIT = 100;

const AVATAR_GRADIENTS = [
  'from-amber-400 to-orange-500',
  'from-sky-400 to-indigo-500',
  'from-emerald-400 to-teal-500',
  'from-rose-400 to-pink-500',
  'from-violet-400 to-purple-500',
  'from-cyan-400 to-blue-500',
];

function authorGradient(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '').join('');
}

function matches(author: AuthorRef, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || author.name.toLowerCase().includes(q) || author.key.includes(q);
}

interface CardProps {
  author: AuthorRef;
  meta: string;
  followed: boolean;
  onToggle: () => void;
  onOpen: () => void;
}

function AuthorCard({ author, meta, followed, onToggle, onOpen }: CardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group flex cursor-pointer items-start gap-3 rounded-xl border border-[#e7e5df] bg-white p-4 text-left transition hover:border-amber-300 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-300/50"
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${authorGradient(author.key)} text-[12px] font-bold text-white shadow-sm`}>
        {initials(author.name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-slate-800 transition-colors group-hover:text-amber-900">
          {author.name}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-slate-500">{meta}</p>
      </div>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onToggle(); }}
        aria-label={followed ? `Unfollow ${author.name}` : `Follow ${author.name}`}
        title={followed ? 'Following — click to unfollow' : 'Follow this author'}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition ${
          followed
            ? 'border-amber-300 bg-amber-50 text-amber-600'
            : 'border-[#e7e5df] text-slate-400 hover:border-amber-300 hover:text-amber-600'
        }`}
      >
        <Heart size={14} fill={followed ? 'currentColor' : 'none'} />
      </button>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="flex animate-pulse items-start gap-3 rounded-xl border border-[#e7e5df] bg-white p-4">
      <span className="h-10 w-10 shrink-0 rounded-full bg-slate-100" />
      <div className="flex-1 space-y-2 pt-1">
        <span className="block h-3 w-2/3 rounded bg-slate-100" />
        <span className="block h-2.5 w-1/2 rounded bg-slate-100" />
      </div>
    </div>
  );
}

export default function AuthorsView({ onBack }: { onBack?: () => void } = {}) {
  const { papers, storageMode, setSelectedPaper } = usePapers();
  const { likedPapers, savedPapers, likedCount, savedCount } = useLibrary();
  const { favouriteAuthors, isFavourite, followAuthor, unfollowAuthor } = useAuthors();

  const [tab, setTab] = useState<Tab>('top');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const [serverTop, setServerTop] = useState<TopAuthor[]>([]);
  const [topLoading, setTopLoading] = useState(false);

  const [directory, setDirectory] = useState<DirectoryAuthor[]>([]);
  const [dirHasMore, setDirHasMore] = useState(false);
  const [dirLoading, setDirLoading] = useState(false);
  const [dirError, setDirError] = useState('');

  const [addName, setAddName] = useState('');
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeTone, setNoticeTone] = useState<'ok' | 'err'>('ok');

  const [selected, setSelected] = useState<AuthorRef | null>(null);
  const [authorPapers, setAuthorPapers] = useState<Paper[]>([]);
  const [authorTotal, setAuthorTotal] = useState(0);
  const [authorLoading, setAuthorLoading] = useState(false);
  const [authorError, setAuthorError] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Top authors come from liked/saved papers. Server mode asks the API because
  // only a window of the library is in memory there.
  useEffect(() => {
    if (storageMode !== 'server') return;
    let cancelled = false;
    setTopLoading(true);
    apiGetTopAuthors(TOP_LIMIT)
      .then(list => { if (!cancelled) setServerTop(list); })
      .catch(e => console.warn('[authors] top authors failed', e))
      .finally(() => { if (!cancelled) setTopLoading(false); });
    return () => { cancelled = true; };
  }, [storageMode, likedCount, savedCount]);

  const localTop = useMemo<TopAuthor[]>(() => {
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
      .slice(0, TOP_LIMIT);
  }, [likedPapers, savedPapers]);

  const topAuthors = storageMode === 'server' ? serverTop : localTop;
  const filteredTop = useMemo(() => topAuthors.filter(a => matches(a, query)), [topAuthors, query]);

  const filteredFollowing = useMemo(
    () => favouriteAuthors.filter(a => matches(a, query)),
    [favouriteAuthors, query],
  );

  // Local directory: aggregate the in-memory library once, then filter.
  const localDirectory = useMemo<DirectoryAuthor[]>(() => {
    const byKey = new Map<string, DirectoryAuthor>();
    for (const paper of papers) {
      for (const author of paper.authorList) {
        const name = author.trim();
        const key = name.toLowerCase();
        if (!key) continue;
        const entry = byKey.get(key);
        if (entry) entry.papers += 1;
        else byKey.set(key, { key, name, papers: 1 });
      }
    }
    return [...byKey.values()].sort((a, b) => b.papers - a.papers || a.name.localeCompare(b.name));
  }, [papers]);

  const localDirectoryFiltered = useMemo(
    () => localDirectory.filter(a => matches(a, debouncedQuery)),
    [localDirectory, debouncedQuery],
  );

  const loadDirectory = useCallback(async (offset: number, append: boolean) => {
    setDirLoading(true);
    setDirError('');
    try {
      const result = await apiGetAllAuthors({ query: debouncedQuery, limit: PAGE, offset });
      setDirectory(prev => append ? [...prev, ...result.authors] : result.authors);
      setDirHasMore(result.hasMore);
    } catch (e) {
      setDirError(e instanceof Error ? e.message : 'Could not load authors.');
    } finally {
      setDirLoading(false);
    }
  }, [debouncedQuery]);

  useEffect(() => {
    if (tab !== 'all') return;
    if (storageMode !== 'server') {
      setDirError('');
      setDirLoading(false);
      setDirectory(localDirectoryFiltered.slice(0, PAGE));
      setDirHasMore(localDirectoryFiltered.length > PAGE);
      return;
    }
    setDirectory([]);
    setDirHasMore(false);
    loadDirectory(0, false);
  }, [tab, storageMode, debouncedQuery, localDirectoryFiltered, loadDirectory]);

  // Author detail — newest papers first. Local mode filters the in-memory
  // library; server mode pages through the API.
  useEffect(() => {
    if (!selected || storageMode === 'server') return;
    const list = papers
      .filter(p => p.authorList.some(a => a.trim().toLowerCase() === selected.key))
      .sort((a, b) => b.digestDate.getTime() - a.digestDate.getTime());
    setAuthorPapers(list.slice(0, PAGE));
    setAuthorTotal(list.length);
    setAuthorLoading(false);
    setAuthorError('');
  }, [selected, storageMode, papers]);

  useEffect(() => {
    if (!selected || storageMode !== 'server') return;
    let cancelled = false;
    setAuthorLoading(true);
    setAuthorError('');
    apiGetAuthorPapers(selected.key, { limit: PAGE, offset: 0 })
      .then(result => {
        if (cancelled) return;
        setAuthorPapers(result.papers);
        setAuthorTotal(result.total);
      })
      .catch(e => { if (!cancelled) setAuthorError(e instanceof Error ? e.message : 'Could not load this author.'); })
      .finally(() => { if (!cancelled) setAuthorLoading(false); });
    return () => { cancelled = true; };
  }, [selected, storageMode]);

  const toggleFollow = async (author: AuthorRef) => {
    try {
      if (isFavourite(author.key)) {
        await unfollowAuthor(author.key);
        setNoticeTone('ok');
        setNotice(`Unfollowed ${author.name}`);
      } else {
        await followAuthor(author.name);
        setNoticeTone('ok');
        setNotice(`Following ${author.name}`);
      }
    } catch (e) {
      setNoticeTone('err');
      setNotice(e instanceof Error ? e.message : 'Could not update this author.');
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = addName.trim();
    if (!name) return;
    setAdding(true);
    setNotice('');
    try {
      // Reuse the library's spelling when we recognise the name, so manually
      // typed authors still match their papers.
      const match = localDirectory.find(a => a.key === name.toLowerCase());
      const author = await followAuthor(match?.name ?? name);
      setAddName('');
      setNoticeTone('ok');
      setNotice(`Following ${author.name}`);
    } catch (err) {
      setNoticeTone('err');
      setNotice(err instanceof Error ? err.message : 'Could not add this author.');
    } finally {
      setAdding(false);
    }
  };

  const loadMoreAuthorPapers = async () => {
    if (!selected) return;
    if (storageMode !== 'server') {
      const list = papers
        .filter(p => p.authorList.some(a => a.trim().toLowerCase() === selected.key))
        .sort((a, b) => b.digestDate.getTime() - a.digestDate.getTime());
      setAuthorPapers(list.slice(0, authorPapers.length + PAGE));
      return;
    }
    setAuthorLoading(true);
    try {
      const result = await apiGetAuthorPapers(selected.key, { limit: PAGE, offset: authorPapers.length });
      setAuthorPapers(prev => [...prev, ...result.papers]);
      setAuthorTotal(result.total);
    } catch (e) {
      setAuthorError(e instanceof Error ? e.message : 'Could not load more papers.');
    } finally {
      setAuthorLoading(false);
    }
  };

  if (selected) {
    const followed = isFavourite(selected.key);
    return (
      <div className="h-full overflow-y-auto main-scroll bg-[#f6f6f3]">
        <div className="mx-auto max-w-[980px] px-5 pb-10 pt-8 sm:px-8">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="mb-5 inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 transition-colors hover:text-slate-800"
          >
            <ArrowLeft size={13} /> Back to authors
          </button>

          <div className="flex flex-wrap items-start gap-4">
            <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${authorGradient(selected.key)} text-lg font-bold text-white shadow-md`}>
              {initials(selected.name)}
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="font-serif text-[30px] leading-none tracking-tight text-slate-900">{selected.name}</h1>
              <p className="mt-2 text-[12px] text-slate-500">
                {authorTotal.toLocaleString()} paper{authorTotal === 1 ? '' : 's'} in your library
              </p>
            </div>
            <button
              type="button"
              onClick={() => toggleFollow(selected)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[12px] font-medium transition ${
                followed
                  ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
                  : 'border-[#e7e5df] bg-white text-slate-600 hover:border-amber-300 hover:text-amber-700'
              }`}
            >
              <Heart size={13} fill={followed ? 'currentColor' : 'none'} />
              {followed ? 'Following' : 'Follow'}
            </button>
          </div>

          {authorError && <p role="alert" className="mt-4 text-[12px] text-rose-600">{authorError}</p>}

          <div className="mt-6 overflow-hidden rounded-xl border border-[#e7e5df] bg-white">
            {authorLoading && authorPapers.length === 0 ? (
              <div className="divide-y divide-[#f0eee8]">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="animate-pulse px-5 py-4">
                    <div className="h-3 w-3/4 rounded bg-slate-100" />
                    <div className="mt-2 h-2.5 w-1/2 rounded bg-slate-100" />
                  </div>
                ))}
              </div>
            ) : authorPapers.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <Users size={22} className="mx-auto mb-3 text-slate-300" />
                <p className="text-[12px] text-slate-500">No papers by this author in your library yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-[#f0eee8]">
                {authorPapers.map(paper => (
                  <button
                    key={paper.id}
                    type="button"
                    onClick={() => setSelectedPaper(paper)}
                    className="block w-full px-5 py-4 text-left transition-colors hover:bg-[#faf9f6]"
                  >
                    <p className="line-clamp-2 text-[13px] font-medium text-slate-800">{paper.title}</p>
                    <p className="mt-1 truncate text-[11px] text-slate-500">
                      {paper.authors || paper.authorList.join(', ')}
                    </p>
                    <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
                      {format(paper.digestDate, 'MMM d, yyyy')} · {paper.arxivId}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {authorPapers.length < authorTotal && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={loadMoreAuthorPapers}
                disabled={authorLoading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#e7e5df] bg-white px-4 py-2 text-[11px] font-medium text-slate-600 transition hover:text-slate-900 disabled:opacity-50"
              >
                {authorLoading && <Loader2 size={12} className="animate-spin" />}
                Load more papers
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode; count?: number }> = [
    { id: 'top', label: 'Top authors', icon: <Sparkles size={13} />, count: topAuthors.length },
    { id: 'following', label: 'Following', icon: <Heart size={13} />, count: favouriteAuthors.length },
    { id: 'all', label: 'All authors', icon: <Library size={13} /> },
  ];

  const searchPlaceholder = tab === 'top'
    ? 'Search top authors…'
    : tab === 'following'
      ? 'Search followed authors…'
      : 'Search all authors…';

  const renderGrid = (children: React.ReactNode) => (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">{children}</div>
  );

  const emptyState = (title: string, body: string) => (
    <div className="rounded-xl border border-[#e7e5df] bg-white px-6 py-14 text-center">
      <Users size={24} className="mx-auto mb-3 text-slate-300" />
      <h2 className="font-serif text-lg text-slate-700">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-sm text-[12px] leading-relaxed text-slate-500">{body}</p>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto main-scroll bg-[#f6f6f3]">
      <div className="mx-auto max-w-[980px] px-5 pb-10 pt-8 sm:px-8">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="mb-4 inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 transition-colors hover:text-slate-800"
          >
            <ArrowLeft size={13} /> Back to dashboard
          </button>
        )}
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Your research desk</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-serif text-[32px] leading-none tracking-tight text-slate-900">Authors</h1>
            <p className="mt-3 max-w-xl text-[13px] text-slate-500">
              The people behind the papers you read. Follow an author to see their work in your feed.
            </p>
          </div>
          <div className="text-right text-[11px] leading-relaxed text-slate-500">
            <p><span className="font-semibold text-slate-800">{favouriteAuthors.length}</span> following</p>
            <p><span className="font-semibold text-slate-800">{topAuthors.length}</span> from your favourites</p>
          </div>
        </div>

        <form onSubmit={handleAdd} className="mt-6 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <UserPlus size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={addName}
              onChange={e => setAddName(e.target.value)}
              placeholder="Add an author by name…"
              aria-label="Add an author by name"
              className="w-full rounded-lg border border-[#e7e5df] bg-white py-2 pl-9 pr-3 text-[12px] text-slate-700 placeholder:text-slate-400 focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-300/40"
            />
          </div>
          <button
            type="submit"
            disabled={!addName.trim() || adding}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-[12px] font-medium text-white transition hover:bg-slate-800 disabled:cursor-default disabled:opacity-40"
          >
            {adding ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
            Follow author
          </button>
        </form>
        {notice && (
          <p className={`mt-2 text-[11px] ${noticeTone === 'err' ? 'text-rose-600' : 'text-emerald-700'}`}>
            {notice}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-full border border-[#e7e5df] bg-white p-1">
            {tabs.map(item => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors ${
                    active
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {item.icon}
                  {item.label}
                  {typeof item.count === 'number' && (
                    <span className={`rounded-full px-1.5 text-[9px] font-semibold ${
                      active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="relative w-full sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="w-full rounded-lg border border-[#e7e5df] bg-white py-2 pl-9 pr-3 text-[12px] text-slate-700 placeholder:text-slate-400 focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-300/40"
            />
          </div>
        </div>

        <div className="mt-5">
          {tab === 'top' && (
            topLoading ? renderGrid([...Array(6)].map((_, i) => <CardSkeleton key={i} />))
            : filteredTop.length === 0 ? emptyState(
              query ? 'No matching authors' : 'No favourite authors yet',
              query
                ? 'Try a different name.'
                : 'Like or save a few papers and their authors will show up here automatically.',
            )
            : renderGrid(filteredTop.map(author => (
              <AuthorCard
                key={author.key}
                author={author}
                meta={`${author.count} liked or saved paper${author.count === 1 ? '' : 's'}`}
                followed={isFavourite(author.key)}
                onToggle={() => toggleFollow(author)}
                onOpen={() => setSelected(author)}
              />
            )))
          )}

          {tab === 'following' && (
            filteredFollowing.length === 0 ? emptyState(
              query ? 'No matching authors' : 'You are not following anyone yet',
              query
                ? 'Try a different name.'
                : 'Add an author above, or tap the heart on any author to follow them.',
            )
            : renderGrid(filteredFollowing.map(author => (
              <AuthorCard
                key={author.key}
                author={author}
                meta="Following"
                followed
                onToggle={() => toggleFollow(author)}
                onOpen={() => setSelected(author)}
              />
            )))
          )}

          {tab === 'all' && (
            dirError ? <p role="alert" className="text-[12px] text-rose-600">{dirError}</p>
            : dirLoading && directory.length === 0 ? renderGrid([...Array(6)].map((_, i) => <CardSkeleton key={i} />))
            : directory.length === 0 ? emptyState(
              'No authors found',
              query ? 'Try a different name.' : 'Your library does not have any author metadata yet.',
            )
            : (
              <>
                {renderGrid(directory.map(author => (
                  <AuthorCard
                    key={author.key}
                    author={author}
                    meta={`${author.papers.toLocaleString()} paper${author.papers === 1 ? '' : 's'} in your library`}
                    followed={isFavourite(author.key)}
                    onToggle={() => toggleFollow(author)}
                    onOpen={() => setSelected(author)}
                  />
                )))}
                {dirHasMore && (
                  <div className="mt-4 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        if (storageMode === 'server') {
                          loadDirectory(directory.length, true);
                        } else {
                          const next = directory.length + PAGE;
                          setDirectory(localDirectoryFiltered.slice(0, next));
                          setDirHasMore(next < localDirectoryFiltered.length);
                        }
                      }}
                      disabled={dirLoading}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#e7e5df] bg-white px-4 py-2 text-[11px] font-medium text-slate-600 transition hover:text-slate-900 disabled:opacity-50"
                    >
                      {dirLoading && <Loader2 size={12} className="animate-spin" />}
                      Load more authors
                    </button>
                  </div>
                )}
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}
