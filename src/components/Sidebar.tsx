import { Search, ChevronDown, SortAsc, SortDesc, X, User, Compass, Target, MailCheck, Upload, MoreHorizontal, Library, Pen, Plus, FileText, Trash2, Mail } from 'lucide-react';
import { useState, useRef, useEffect, useMemo } from 'react';
import { usePapers } from '../contexts/PapersContext';
import { useLibrary } from '../contexts/LibraryContext';
import { useTracking } from '../contexts/TrackingContext';
import { useBooks } from '../contexts/BooksContext';
import { useWriter } from '../contexts/WriterContext';
import { useCollections } from '../contexts/CollectionsContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { TRACKER_COLOR_CLASSES } from '../utils/trackerScoring';
import { usePagination } from '../hooks/usePagination';
import Pager from './Pager';
import { getCategoryLabel } from '../utils/categories';
import { ASSESSMENT_BADGE, AssessmentLabel } from '../utils/assessment';
import PaperCard from './PaperCard';
import ImportModal from './ImportModal';
import { ActiveView } from './AppLayout';
import { SortField } from '../types';
import { formatDistanceToNow, format } from 'date-fns';

interface Props {
  activeView: ActiveView;
  setActiveView: (v: ActiveView) => void;
}

const SORT_OPTIONS: Array<{ value: SortField; label: string }> = [
  { value: 'date',    label: 'Date' },
  { value: 'title',   label: 'Title' },
  { value: 'authors', label: 'Author' },
  { value: 'score',   label: 'Score' },
];

const ASSESSMENT_LEVELS: AssessmentLabel[] = ['In Depth', 'Notable', 'Standard', 'Brief'];

export default function Sidebar({ activeView }: Props) {
  // The wide sidebar's content is contextual: it adapts to the active workspace.
  return (
    <aside className="w-80 shrink-0 flex flex-col bg-slate-900 h-full border-r border-slate-800 overflow-hidden">
      {activeView === 'inbox'    && <InboxPane />}
      {activeView === 'library'  && <LibraryPane />}
      {activeView === 'discover' && <SimplePane icon={<Compass size={24} className="text-indigo-400" />} title="Discover" hint="Search any topic in the main panel — Semantic Scholar will surface the foundational, recent, and survey papers." />}
      {activeView === 'tracking' && <TrackingPane />}
      {activeView === 'books'       && <BooksPane />}
      {activeView === 'writer'      && <WriterPane />}
      {activeView === 'collections' && <CollectionsPane />}
    </aside>
  );
}

// =========================================================================
// Inbox pane — search, filters, paper list, bulk actions
// =========================================================================

function InboxPane() {
  const {
    filteredPapers, papers, loading, progress, error,
    setSelectedPaper,
    searchQuery, setSearchQuery,
    selectedCategory, setSelectedCategory,
    authorFilter, setAuthorFilter,
    assessmentFilter, setAssessmentFilter,
    allCategories, allAuthors,
    sortBy, setSortBy, sortDir, setSortDir,
    lastSynced, activeFilterCount, unreadCount,
    markAllRead, markAllUnread, markManyRead, markManyUnread,
  } = usePapers();
  const [showCatMenu,  setShowCatMenu]  = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showAuthorInput, setShowAuthorInput] = useState(!!authorFilter);
  const [showImport,  setShowImport]  = useState(false);
  const searchRef    = useRef<HTMLDivElement>(null);
  const moreMenuRef  = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (searchRef.current   && !searchRef.current.contains(e.target as Node))   setShowSuggestions(false);
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) setShowMoreMenu(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  const suggestions = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (q.length < 2) return { authors: [], papers: [], categories: [] };
    return {
      authors:    allAuthors   .filter(a => a.toLowerCase().includes(q)).slice(0, 5),
      papers:     papers       .filter(p => p.title.toLowerCase().includes(q)).slice(0, 4),
      categories: allCategories.filter(c => c.toLowerCase().includes(q) || getCategoryLabel(c).toLowerCase().includes(q)).slice(0, 3),
    };
  }, [searchQuery, papers, allAuthors, allCategories]);

  const hasSuggestions = suggestions.authors.length + suggestions.papers.length + suggestions.categories.length > 0;

  function clearAllFilters() {
    setSelectedCategory('');
    setAuthorFilter('');
    setAssessmentFilter('');
    setShowAuthorInput(false);
  }

  return (
    <>
      <PaneHeader title="Inbox" subtitle={lastSynced ? `synced ${formatDistanceToNow(lastSynced, { addSuffix: true })}` : 'never synced'} />

      {loading && (
        <div className="h-0.5 bg-slate-800">
          <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      )}
      {error && (
        <div className={`mx-3 mt-3 px-3 py-2 rounded-lg border text-xs ${
          error.startsWith('You are offline')
            ? 'bg-amber-900/20 border-amber-700 text-amber-400'
            : 'bg-red-900/30 border-red-800 text-red-400'
        }`}>{error}</div>
      )}

      {/* Search + filters */}
      <div className="px-3 py-3 border-b border-slate-800 space-y-2">
        <div ref={searchRef} className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={e => { if (e.key === 'Escape') setShowSuggestions(false); }}
            placeholder="Search titles, authors, abstracts…"
            className="w-full bg-slate-800 text-slate-300 placeholder-slate-500 text-xs pl-7 pr-7 py-2 rounded-lg border border-slate-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
              <X size={12} />
            </button>
          )}
          {showSuggestions && hasSuggestions && (
            <div className="absolute top-full left-0 right-0 mt-1 z-40 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden max-h-72 overflow-y-auto custom-scroll">
              {suggestions.authors.length > 0 && (
                <SuggestionGroup title="Authors">
                  {suggestions.authors.map(author => (
                    <button key={author} onMouseDown={e => { e.preventDefault(); setAuthorFilter(author); setShowAuthorInput(true); setShowSuggestions(false); setSearchQuery(''); }}
                      className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 flex items-center gap-2 transition-colors">
                      <User size={11} className="text-slate-500 shrink-0" /><span className="truncate">{author}</span>
                    </button>
                  ))}
                </SuggestionGroup>
              )}
              {suggestions.papers.length > 0 && (
                <SuggestionGroup title="Papers">
                  {suggestions.papers.map(p => (
                    <button key={p.id} onMouseDown={e => { e.preventDefault(); setSelectedPaper(p); setShowSuggestions(false); setSearchQuery(''); }}
                      className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 transition-colors">
                      <p className="truncate font-medium">{p.title}</p>
                      <p className="text-slate-500 truncate mt-0.5">{p.authorList[0]}{p.authorList.length > 1 ? ' et al.' : ''}</p>
                    </button>
                  ))}
                </SuggestionGroup>
              )}
              {suggestions.categories.length > 0 && (
                <SuggestionGroup title="Categories">
                  {suggestions.categories.map(cat => (
                    <button key={cat} onMouseDown={e => { e.preventDefault(); setSelectedCategory(cat); setShowSuggestions(false); setSearchQuery(''); }}
                      className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 flex items-center gap-2 transition-colors">
                      <span className="font-mono text-blue-400">{cat}</span>
                      <span className="text-slate-500 truncate">{getCategoryLabel(cat)}</span>
                    </button>
                  ))}
                </SuggestionGroup>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <button onClick={() => { setShowCatMenu(v => !v); setShowSortMenu(false); }}
              className="w-full flex items-center justify-between bg-slate-800 text-xs text-slate-400 px-2.5 py-2 rounded-lg border border-slate-700 hover:border-slate-600 transition-all">
              <span className="truncate">{selectedCategory || 'Category'}</span>
              <ChevronDown size={11} className={`ml-1 shrink-0 transition-transform ${showCatMenu ? 'rotate-180' : ''}`} />
            </button>
            {showCatMenu && (
              <div className="absolute top-full left-0 right-0 mt-1 z-30 bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden max-h-48 overflow-y-auto custom-scroll">
                <button onClick={() => { setSelectedCategory(''); setShowCatMenu(false); }}
                  className={`w-full text-left px-3 py-2 text-xs transition-colors ${!selectedCategory ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}>All categories</button>
                {allCategories.map(cat => (
                  <button key={cat} onClick={() => { setSelectedCategory(cat); setShowCatMenu(false); }}
                    className={`w-full text-left px-3 py-2 text-xs transition-colors ${selectedCategory === cat ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}>
                    <span className="font-mono">{cat}</span>
                    <span className="text-slate-500 ml-1.5 text-[10px]">{getCategoryLabel(cat)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative">
            <button onClick={() => { setShowSortMenu(v => !v); setShowCatMenu(false); }}
              className="flex items-center gap-1 bg-slate-800 text-xs text-slate-400 px-2.5 py-2 rounded-lg border border-slate-700 hover:border-slate-600 transition-all">
              {sortDir === 'desc' ? <SortDesc size={13} /> : <SortAsc size={13} />}
              <span>{SORT_OPTIONS.find(o => o.value === sortBy)?.label}</span>
            </button>
            {showSortMenu && (
              <div className="absolute top-full right-0 mt-1 z-30 w-36 bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden">
                {SORT_OPTIONS.map(opt => (
                  <button key={opt.value}
                    onClick={() => {
                      if (sortBy === opt.value) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
                      else { setSortBy(opt.value); setSortDir(opt.value === 'title' || opt.value === 'authors' ? 'asc' : 'desc'); }
                      setShowSortMenu(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition-colors ${sortBy === opt.value ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}>
                    {opt.label}
                    {sortBy === opt.value && (sortDir === 'desc' ? <SortDesc size={11} /> : <SortAsc size={11} />)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {showAuthorInput ? (
          <div className="relative">
            <User size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input type="text" value={authorFilter} onChange={e => setAuthorFilter(e.target.value)} placeholder="Filter by author…"
              className="w-full bg-slate-800 text-slate-300 placeholder-slate-500 text-xs pl-7 pr-7 py-2 rounded-lg border border-amber-700/50 focus:outline-none focus:border-amber-500/70 transition-all"
            />
            <button onClick={() => { setAuthorFilter(''); setShowAuthorInput(false); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"><X size={12} /></button>
          </div>
        ) : (
          <button onClick={() => setShowAuthorInput(true)} className="w-full flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-400 transition-colors px-1">
            <User size={11} />Filter by author
          </button>
        )}

        <div className="flex gap-1 flex-wrap">
          {ASSESSMENT_LEVELS.map(level => (
            <button key={level} onClick={() => setAssessmentFilter(assessmentFilter === level ? '' : level)}
              className={`text-[10px] font-semibold px-2 py-1 rounded-full border transition-all ${
                assessmentFilter === level
                  ? ASSESSMENT_BADGE[level] + ' ring-1 ring-offset-1 ring-offset-slate-900 ring-current'
                  : 'bg-slate-800 text-slate-500 border-slate-700 hover:border-slate-500'
              }`}>{level}</button>
          ))}
        </div>

        {activeFilterCount > 0 && (
          <button onClick={clearAllFilters} className="w-full text-[10px] text-slate-500 hover:text-red-400 transition-colors flex items-center gap-1 justify-center">
            <X size={10} />Clear {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''}
          </button>
        )}
      </div>

      {/* Toolbar: counts + bulk actions */}
      <div className="px-3 py-2 border-b border-slate-800 flex items-center gap-1.5">
        <p className="text-[11px] text-slate-500 truncate flex-1">{filteredPapers.length} of {papers.length} · {unreadCount} unread</p>
        <button onClick={() => setShowImport(true)} title="Import papers"
          className="p-1.5 rounded-md text-slate-500 hover:text-blue-400 hover:bg-slate-800 transition-all"><Upload size={12} /></button>
        <button onClick={() => markManyRead(filteredPapers.map(p => p.id))} title="Mark visible as read" disabled={filteredPapers.length === 0}
          className="p-1.5 rounded-md text-slate-500 hover:text-emerald-400 hover:bg-slate-800 transition-all disabled:opacity-40"><MailCheck size={12} /></button>
        <div ref={moreMenuRef} className="relative">
          <button onClick={() => setShowMoreMenu(v => !v)} title="More" className="p-1.5 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-all">
            <MoreHorizontal size={12} />
          </button>
          {showMoreMenu && (
            <div className="absolute right-0 top-full mt-1 z-30 w-52 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl overflow-hidden">
              <MenuItem icon={<MailCheck size={11} className="text-emerald-400" />} label="Mark all read"   onClick={() => { markAllRead(); setShowMoreMenu(false); }} />
              <MenuItem icon={<Mail      size={11} className="text-blue-400"    />} label="Mark all unread" onClick={() => { markAllUnread(); setShowMoreMenu(false); }} />
              <div className="border-t border-slate-700 my-0.5" />
              <MenuItem icon={<Mail size={11} />} label="Mark visible as unread"
                onClick={() => { markManyUnread(filteredPapers.map(p => p.id)); setShowMoreMenu(false); }}
                disabled={filteredPapers.length === 0} />
              <div className="border-t border-slate-700 my-0.5" />
              <MenuItem icon={<Upload size={11} className="text-blue-400" />} label="Import papers…" onClick={() => { setShowImport(true); setShowMoreMenu(false); }} />
            </div>
          )}
        </div>
      </div>

      {/* Paper list */}
      <InboxList loading={loading} />

      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
    </>
  );
}

function InboxList({ loading }: { loading: boolean }) {
  const { filteredPapers, papers, selectedPaper, setSelectedPaper, readIds } = usePapers();
  const { isSaved } = useLibrary();
  const pager = usePagination(filteredPapers, 50);

  return (
    <>
      <div className="flex-1 overflow-y-auto custom-scroll">
        {loading && filteredPapers.length === 0 && <div className="px-4 py-8 text-center text-slate-500 text-xs">Loading papers…</div>}
        {!loading && filteredPapers.length === 0 && papers.length > 0 && (
          <div className="px-4 py-8 text-center text-slate-500 text-xs">No papers match your filters.</div>
        )}
        {pager.slice.map(paper => (
          <PaperCard
            key={paper.id}
            paper={paper}
            isSelected={selectedPaper?.id === paper.id}
            isSaved={isSaved(paper.id)}
            isRead={readIds.has(paper.id)}
            onClick={() => setSelectedPaper(paper)}
          />
        ))}
      </div>
      <Pager pagination={pager} variant="dark" size="sm" label="papers" pageSizes={[25, 50, 100, 250]} />
    </>
  );
}

// =========================================================================
// Library pane — saved papers
// =========================================================================

function LibraryPane() {
  const { savedPapers, isSaved } = useLibrary();
  const { selectedPaper, setSelectedPaper, readIds } = usePapers();
  const pager = usePagination(savedPapers, 50);
  return (
    <>
      <PaneHeader title="Library" subtitle={`${savedPapers.length} saved paper${savedPapers.length !== 1 ? 's' : ''}`} />
      <div className="flex-1 overflow-y-auto custom-scroll">
        {savedPapers.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <BookMarkedDot />
            <p className="text-slate-500 text-xs mt-3">No saved papers yet.</p>
            <p className="text-slate-600 text-[11px] mt-1">Bookmark papers from your inbox.</p>
          </div>
        ) : pager.slice.map(p => (
          <PaperCard
            key={p.id}
            paper={p}
            isSelected={selectedPaper?.id === p.id}
            isSaved={isSaved(p.id)}
            isRead={readIds.has(p.id)}
            onClick={() => setSelectedPaper(p)}
          />
        ))}
      </div>
      <Pager pagination={pager} variant="dark" size="sm" label="saved" pageSizes={[25, 50, 100]} />
    </>
  );
}

function BookMarkedDot() { return <div className="w-12 h-12 rounded-2xl bg-slate-800 mx-auto flex items-center justify-center"><MailCheck size={20} className="text-slate-600" /></div>; }

// =========================================================================
// Tracking pane — list of trackers
// =========================================================================

function TrackingPane() {
  const { trackers, matchesByTracker, scoring } = useTracking();
  return (
    <>
      <PaneHeader title="Tracking" subtitle={`${trackers.length} tracker${trackers.length !== 1 ? 's' : ''}`} />
      <div className="flex-1 overflow-y-auto custom-scroll px-2 py-3 space-y-1">
        {trackers.length === 0 ? (
          <div className="text-center px-4 py-8">
            <Target size={24} className="mx-auto text-emerald-400/40 mb-2" />
            <p className="text-slate-400 text-xs">No trackers yet.</p>
            <p className="text-slate-600 text-[11px] mt-1">Create one in the main panel.</p>
          </div>
        ) : trackers.map(t => {
          const count = matchesByTracker(t.id).length;
          const cls   = TRACKER_COLOR_CLASSES[t.color] ?? TRACKER_COLOR_CLASSES.blue;
          return (
            <div key={t.id} className="px-3 py-2 rounded-lg text-xs text-slate-300 flex items-center justify-between hover:bg-slate-800/60 transition-colors">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-2 h-2 rounded-full ${cls.dot} shrink-0`} />
                <span className="truncate font-medium">{t.name}</span>
                {!t.enabled && <span className="text-[9px] uppercase font-semibold text-slate-500 px-1 py-0.5 rounded bg-slate-800">off</span>}
              </div>
              <span className="text-[10px] font-semibold text-slate-500">{count}</span>
            </div>
          );
        })}
        {scoring && <p className="text-[10px] text-slate-500 text-center mt-2 animate-pulse">scoring {scoring.done}/{scoring.total}…</p>}
      </div>
    </>
  );
}

// =========================================================================
// Books pane — list of books
// =========================================================================

function BooksPane() {
  const { books, loading, dbEnabled } = useBooks();
  const pager = usePagination(books, 30);
  return (
    <>
      <PaneHeader title="Books" subtitle={dbEnabled ? `${books.length} book${books.length !== 1 ? 's' : ''}` : 'requires server DB'} />
      <div className="flex-1 overflow-y-auto custom-scroll px-2 py-3">
        {!dbEnabled ? (
          <DbDisabledHint />
        ) : loading ? (
          <p className="text-center text-slate-500 text-xs py-6">Loading…</p>
        ) : books.length === 0 ? (
          <div className="text-center py-8 px-3">
            <Library size={24} className="mx-auto text-cyan-400/40 mb-2" />
            <p className="text-slate-400 text-xs">No books yet.</p>
            <p className="text-slate-600 text-[11px] mt-1">Click "Add book" in the main panel.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {pager.slice.map(b => (
              <div key={b.id} className="px-3 py-2 rounded-lg text-xs hover:bg-slate-800/60 transition-colors">
                <p className="text-slate-200 font-medium truncate">{b.title}</p>
                <p className="text-slate-500 truncate mt-0.5">{b.authors.join(', ') || '—'}{b.year ? ` · ${b.year}` : ''}</p>
              </div>
            ))}
          </div>
        )}
      </div>
      {books.length > 0 && <Pager pagination={pager} variant="dark" size="sm" label="books" pageSizes={[30, 60]} />}
    </>
  );
}

// =========================================================================
// Writer pane — list of documents (clickable)
// =========================================================================

function WriterPane() {
  const { documents, active, dbEnabled, setActiveId, newDocument, removeDocument } = useWriter();
  const confirm = useConfirm();
  const pager = usePagination(documents, 30);

  async function handleDelete(d: { id: string; title: string; wordCount?: number }) {
    const ok = await confirm({
      title: 'Delete document?',
      message: `"${d.title || 'Untitled'}" — ${(d.wordCount ?? 0).toLocaleString()} word${(d.wordCount ?? 0) !== 1 ? 's' : ''}. This can't be undone.`,
      confirmLabel: 'Delete document',
      destructive: true,
    });
    if (ok) removeDocument(d.id);
  }

  return (
    <>
      <PaneHeader
        title="Writer"
        subtitle={dbEnabled ? `${documents.length} draft${documents.length !== 1 ? 's' : ''}` : 'requires server DB'}
        right={dbEnabled ? (
          <button onClick={() => newDocument()} title="New document" className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800">
            <Plus size={13} />
          </button>
        ) : null}
      />
      <div className="flex-1 overflow-y-auto custom-scroll px-2 py-2 space-y-0.5">
        {!dbEnabled ? (
          <DbDisabledHint />
        ) : documents.length === 0 ? (
          <div className="text-center py-8 px-3">
            <Pen size={24} className="mx-auto text-violet-400/40 mb-2" />
            <p className="text-slate-400 text-xs">No drafts yet.</p>
            <button onClick={() => newDocument()} className="mt-3 text-xs text-violet-400 hover:text-violet-300">Start your first document →</button>
          </div>
        ) : pager.slice.map(d => {
          const isActive = active?.id === d.id;
          return (
            <button
              key={d.id}
              onClick={() => setActiveId(d.id)}
              className={`w-full text-left px-3 py-2 rounded-lg transition-colors group ${
                isActive ? 'bg-violet-600/20 border-l-2 border-l-violet-500' : 'border-l-2 border-l-transparent hover:bg-slate-800/60'
              }`}
            >
              <div className="flex items-start gap-2">
                <FileText size={12} className="text-slate-500 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-medium truncate ${isActive ? 'text-white' : 'text-slate-200'}`}>{d.title || 'Untitled'}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {(d.wordCount ?? 0)} word{(d.wordCount ?? 0) !== 1 ? 's' : ''} · {format(new Date(d.updatedAt), 'MMM d')}
                  </p>
                </div>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={e => { e.stopPropagation(); handleDelete(d); }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); handleDelete(d); } }}
                  className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all cursor-pointer p-0.5"
                  title="Delete"
                >
                  <Trash2 size={11} />
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {documents.length > 0 && <Pager pagination={pager} variant="dark" size="sm" label="drafts" pageSizes={[30, 60]} />}
    </>
  );
}

// =========================================================================
// Collections pane
// =========================================================================

function CollectionsPane() {
  const { collections, dbEnabled } = useCollections();
  return (
    <>
      <PaneHeader title="Collections" subtitle={dbEnabled ? `${collections.length} bundle${collections.length !== 1 ? 's' : ''}` : 'requires server DB'} />
      <div className="flex-1 overflow-y-auto custom-scroll px-2 py-2 space-y-0.5">
        {!dbEnabled ? <DbDisabledHint /> : collections.length === 0 ? (
          <div className="text-center py-8 px-3">
            <FolderOpenIcon />
            <p className="text-slate-400 text-xs mt-3">No collections yet.</p>
            <p className="text-slate-600 text-[11px] mt-1">Create one in the main panel.</p>
          </div>
        ) : collections.map(c => {
          const cls = TRACKER_COLOR_CLASSES[c.color] ?? TRACKER_COLOR_CLASSES.blue;
          return (
            <div key={c.id} className="px-3 py-2 rounded-lg text-xs hover:bg-slate-800/60 transition-colors">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-2 h-2 rounded-full ${cls.dot} shrink-0`} />
                <span className="text-slate-200 truncate font-medium flex-1">{c.name}</span>
                <span className="text-[10px] font-semibold text-slate-500">{c.items.length}</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function FolderOpenIcon() {
  return (
    <div className="w-12 h-12 rounded-2xl bg-slate-800 mx-auto flex items-center justify-center">
      <svg className="w-5 h-5 text-fuchsia-400/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
      </svg>
    </div>
  );
}

// =========================================================================
// Shared sub-components
// =========================================================================

function PaneHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-white truncate">{title}</h2>
        {subtitle && <p className="text-[11px] text-slate-500 truncate mt-0.5">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

function SimplePane({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <>
      <PaneHeader title={title} />
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
        <div className="mb-3">{icon}</div>
        <p className="text-slate-400 text-xs leading-relaxed">{hint}</p>
      </div>
    </>
  );
}

function MenuItem({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-left">
      {icon}{label}
    </button>
  );
}

function SuggestionGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider sticky top-0 bg-slate-800/95">{title}</div>
      {children}
    </div>
  );
}

function DbDisabledHint() {
  return (
    <div className="m-2 p-4 rounded-lg bg-amber-900/20 border border-amber-700 text-xs text-amber-300 leading-relaxed">
      <p className="font-semibold mb-1">Server storage required</p>
      <p>Books and Writer drafts live in Postgres. Start the local DB with <code className="px-1 py-0.5 bg-slate-800 rounded font-mono">npm run db:up</code> and set <code className="px-1 py-0.5 bg-slate-800 rounded font-mono">DATABASE_URL</code>.</p>
    </div>
  );
}
