import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Bookmark, BookmarkCheck, Heart, Loader2, Users } from 'lucide-react';
import { usePapers } from '../contexts/PapersContext';
import { useLibrary } from '../contexts/LibraryContext';
import { useAuthors } from '../contexts/AuthorsContext';
import { apiGetFollowingPapers } from '../utils/researchApi';
import type { Paper } from '../types';

const PAGE = 20;

// The dashboard's "Following" tab: newest papers by any author the user
// explicitly follows. Server mode pages through the whole library; local mode
// filters the in-memory list.
export default function FollowingFeed({ onManageAuthors }: { onManageAuthors?: () => void }) {
  const { papers, storageMode, setSelectedPaper } = usePapers();
  const { isLiked, likePaper, unlikePaper, isSaved, savePaper, unsavePaper } = useLibrary();
  const { favouriteAuthors } = useAuthors();

  const [feed, setFeed] = useState<Paper[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const favouriteKeys = useMemo(
    () => new Set(favouriteAuthors.map(a => a.key)),
    [favouriteAuthors],
  );

  const localFeed = useMemo(() => papers
    .filter(p => p.authorList.some(a => favouriteKeys.has(a.trim().toLowerCase())))
    .sort((a, b) => b.digestDate.getTime() - a.digestDate.getTime()),
  [papers, favouriteKeys]);

  const load = useCallback(async (offset: number, append: boolean) => {
    setLoading(true);
    setError('');
    try {
      const result = await apiGetFollowingPapers({ limit: PAGE, offset });
      setFeed(prev => append ? [...prev, ...result.papers] : result.papers);
      setTotal(result.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the following feed.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (storageMode === 'server') return;
    setFeed(localFeed.slice(0, PAGE));
    setTotal(localFeed.length);
    setError('');
  }, [storageMode, localFeed]);

  useEffect(() => {
    if (storageMode !== 'server') return;
    setFeed([]);
    load(0, false);
  }, [storageMode, load, favouriteAuthors.length]);

  const loadMore = () => {
    if (storageMode === 'server') {
      load(feed.length, true);
    } else {
      const next = feed.length + PAGE;
      setFeed(localFeed.slice(0, next));
    }
  };

  const toggleAbstract = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (favouriteAuthors.length === 0) {
    return (
      <div className="rounded-xl border border-[#e7e5df] bg-white px-6 py-14 text-center">
        <Users size={24} className="mx-auto mb-3 text-slate-300" />
        <h2 className="font-serif text-lg text-slate-700">You are not following anyone yet</h2>
        <p className="mx-auto mt-1.5 max-w-sm text-[12px] leading-relaxed text-slate-500">
          Follow authors whose work you care about and their newest papers will land here.
        </p>
        {onManageAuthors && (
          <button
            type="button"
            onClick={onManageAuthors}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-[12px] font-medium text-white transition hover:bg-slate-800"
          >
            <Users size={13} /> Browse authors
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-[11px] text-slate-500">
        <span>
          Following <span className="font-semibold text-slate-700">{favouriteAuthors.length}</span> author{favouriteAuthors.length === 1 ? '' : 's'}
          {total > 0 && <> · {total.toLocaleString()} paper{total === 1 ? '' : 's'}</>}
        </span>
        {onManageAuthors && (
          <button
            type="button"
            onClick={onManageAuthors}
            className="font-medium text-slate-500 transition-colors hover:text-slate-900"
          >
            Manage authors →
          </button>
        )}
      </div>

      {error && <p role="alert" className="mb-3 text-[12px] text-rose-600">{error}</p>}

      <div className="overflow-hidden rounded-xl border border-[#e7e5df] bg-white">
        {loading && feed.length === 0 ? (
          <div className="divide-y divide-[#f0eee8]">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="animate-pulse px-5 py-4">
                <div className="h-3 w-3/4 rounded bg-slate-100" />
                <div className="mt-2 h-2.5 w-1/2 rounded bg-slate-100" />
              </div>
            ))}
          </div>
        ) : feed.length === 0 ? (
          <div className="px-6 py-12 text-center text-[12px] text-slate-500">
            No papers by your followed authors in the library yet.
          </div>
        ) : (
          <div className="divide-y divide-[#f0eee8]">
            {feed.map(paper => {
              const liked = isLiked(paper.id);
              const saved = isSaved(paper.id);
              const isOpen = expanded.has(paper.id);
              return (
                <div key={paper.id} className="px-5 py-4 transition-colors hover:bg-[#faf9f6]">
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedPaper(paper)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="line-clamp-2 text-[13px] font-medium text-slate-800">{paper.title}</p>
                      <p className="mt-1 truncate text-[11px] text-slate-500">
                        {paper.authors || paper.authorList.join(', ')}
                      </p>
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
                        {format(paper.digestDate, 'MMM d, yyyy')} · {paper.arxivId}
                      </p>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => (liked ? unlikePaper(paper.id) : likePaper(paper))}
                        aria-label={liked ? 'Unlike' : 'Like'}
                        className={`flex h-7 w-7 items-center justify-center rounded-full transition ${
                          liked ? 'text-rose-500' : 'text-slate-300 hover:text-rose-400'
                        }`}
                      >
                        <Heart size={14} fill={liked ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        type="button"
                        onClick={() => (saved ? unsavePaper(paper.id) : savePaper(paper))}
                        aria-label={saved ? 'Remove from library' : 'Save to library'}
                        className={`flex h-7 w-7 items-center justify-center rounded-full transition ${
                          saved ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'
                        }`}
                      >
                        {saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
                      </button>
                    </div>
                  </div>
                  {paper.abstract && (
                    <div className="mt-2">
                      <p className={`text-[11.5px] leading-relaxed text-slate-600 ${isOpen ? '' : 'line-clamp-2'}`}>
                        {paper.abstract}
                      </p>
                      <button
                        type="button"
                        onClick={() => toggleAbstract(paper.id)}
                        className="mt-1 text-[10px] font-medium text-slate-400 hover:text-slate-700"
                      >
                        {isOpen ? 'Show less' : 'Read abstract'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {feed.length < total && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#e7e5df] bg-white px-4 py-2 text-[11px] font-medium text-slate-600 transition hover:text-slate-900 disabled:opacity-50"
          >
            {loading && <Loader2 size={12} className="animate-spin" />}
            Load more
          </button>
        </div>
      )}
    </div>
  );
}