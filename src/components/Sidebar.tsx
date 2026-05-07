import { Search, RefreshCw, Settings, LogOut, ChevronDown, SortAsc, SortDesc, Inbox, BookMarked, X, User } from 'lucide-react';
import { useState, useRef, useEffect, useMemo } from 'react';
import { usePapers } from '../contexts/PapersContext';
import { useAuth } from '../contexts/AuthContext';
import { useLibrary } from '../contexts/LibraryContext';
import { getCategoryLabel } from '../utils/categories';
import { ASSESSMENT_BADGE } from '../utils/assessment';
import { AssessmentLabel } from '../utils/assessment';
import PaperCard from './PaperCard';
import SettingsModal from './SettingsModal';
import { ActiveView } from './AppLayout';
import { SortField } from '../types';
import { formatDistanceToNow } from 'date-fns';

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

export default function Sidebar({ activeView, setActiveView }: Props) {
  const {
    filteredPapers, papers, loading, progress, error,
    selectedPaper, setSelectedPaper,
    searchQuery, setSearchQuery,
    selectedCategory, setSelectedCategory,
    authorFilter, setAuthorFilter,
    assessmentFilter, setAssessmentFilter,
    allCategories, allAuthors, sync,
    sortBy, setSortBy, sortDir, setSortDir,
    lastSynced, activeFilterCount,
  } = usePapers();
  const { user, logout } = useAuth();
  const { savedPapers, isSaved } = useLibrary();
  const [showSettings, setShowSettings] = useState(false);
  const [showCatMenu,  setShowCatMenu]  = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showAuthorInput, setShowAuthorInput] = useState(!!authorFilter);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  // Suggestion computation
  const suggestions = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (q.length < 2) return { authors: [], papers: [], categories: [] };

    const matchAuthors = allAuthors.filter(a => a.toLowerCase().includes(q)).slice(0, 5);
    const matchPapers  = papers.filter(p => p.title.toLowerCase().includes(q)).slice(0, 4);
    const matchCats    = allCategories.filter(c =>
      c.toLowerCase().includes(q) || getCategoryLabel(c).toLowerCase().includes(q)
    ).slice(0, 3);

    return { authors: matchAuthors, papers: matchPapers, categories: matchCats };
  }, [searchQuery, papers, allAuthors, allCategories]);

  const hasSuggestions =
    suggestions.authors.length + suggestions.papers.length + suggestions.categories.length > 0;

  const displayPapers = activeView === 'library' ? savedPapers : filteredPapers;
  const totalCount    = activeView === 'library' ? savedPapers.length : papers.length;

  function clearAllFilters() {
    setSelectedCategory('');
    setAuthorFilter('');
    setAssessmentFilter('');
    setShowAuthorInput(false);
  }

  return (
    <>
      <aside className="w-80 shrink-0 flex flex-col bg-slate-900 h-full border-r border-slate-800">
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-slate-800">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-white" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                </svg>
              </div>
              <div>
                <span className="text-sm font-semibold text-white">arXiv Reader</span>
                {lastSynced && (
                  <p className="text-[10px] text-slate-600 leading-none mt-0.5">
                    synced {formatDistanceToNow(lastSynced, { addSuffix: true })}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {activeView === 'inbox' && (
                <button onClick={() => sync(true)} disabled={loading} title="Sync emails"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all disabled:opacity-50">
                  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </button>
              )}
              <button onClick={() => setShowSettings(true)} title="Settings"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all">
                <Settings size={14} />
              </button>
              <button onClick={logout} title="Sign out"
                className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-all">
                <LogOut size={14} />
              </button>
            </div>
          </div>
          {user?.email && <p className="text-[11px] text-slate-500 truncate mt-1">{user.email}</p>}
        </div>

        {/* Loading bar */}
        {loading && (
          <div className="h-0.5 bg-slate-800">
            <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        )}

        {error && (
          <div className="mx-3 mt-3 px-3 py-2 rounded-lg bg-red-900/30 border border-red-800 text-red-400 text-xs">{error}</div>
        )}

        {/* Inbox / Library tabs */}
        <div className="flex border-b border-slate-800">
          <button onClick={() => setActiveView('inbox')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-all ${
              activeView === 'inbox' ? 'text-white border-b-2 border-blue-500 bg-slate-800/30' : 'text-slate-500 hover:text-slate-300'
            }`}>
            <Inbox size={13} />
            Inbox
            {papers.length > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${activeView === 'inbox' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
                {papers.length}
              </span>
            )}
          </button>
          <button onClick={() => { setActiveView('library'); setSelectedPaper(null); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-all ${
              activeView === 'library' ? 'text-white border-b-2 border-amber-500 bg-slate-800/30' : 'text-slate-500 hover:text-slate-300'
            }`}>
            <BookMarked size={13} />
            Library
            {savedPapers.length > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${activeView === 'library' ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
                {savedPapers.length}
              </span>
            )}
          </button>
        </div>

        {/* Search + filters (inbox only) */}
        {activeView === 'inbox' && (
          <div className="px-3 py-3 border-b border-slate-800 space-y-2">
            {/* Search with suggestions */}
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
                <button onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  <X size={12} />
                </button>
              )}

              {/* Suggestions dropdown */}
              {showSuggestions && hasSuggestions && (
                <div className="absolute top-full left-0 right-0 mt-1 z-40 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden max-h-72 overflow-y-auto custom-scroll">
                  {suggestions.authors.length > 0 && (
                    <div>
                      <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider sticky top-0 bg-slate-800/95">
                        Authors
                      </div>
                      {suggestions.authors.map(author => (
                        <button key={author}
                          onMouseDown={e => { e.preventDefault(); setAuthorFilter(author); setShowAuthorInput(true); setShowSuggestions(false); setSearchQuery(''); }}
                          className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 flex items-center gap-2 transition-colors">
                          <User size={11} className="text-slate-500 shrink-0" />
                          <span className="truncate">{author}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {suggestions.papers.length > 0 && (
                    <div>
                      <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider sticky top-0 bg-slate-800/95">
                        Papers
                      </div>
                      {suggestions.papers.map(p => (
                        <button key={p.id}
                          onMouseDown={e => { e.preventDefault(); setSelectedPaper(p); setShowSuggestions(false); setSearchQuery(''); }}
                          className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 transition-colors">
                          <p className="truncate font-medium">{p.title}</p>
                          <p className="text-slate-500 truncate mt-0.5">{p.authorList[0]}{p.authorList.length > 1 ? ' et al.' : ''}</p>
                        </button>
                      ))}
                    </div>
                  )}
                  {suggestions.categories.length > 0 && (
                    <div>
                      <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider sticky top-0 bg-slate-800/95">
                        Categories
                      </div>
                      {suggestions.categories.map(cat => (
                        <button key={cat}
                          onMouseDown={e => { e.preventDefault(); setSelectedCategory(cat); setShowSuggestions(false); setSearchQuery(''); }}
                          className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 flex items-center gap-2 transition-colors">
                          <span className="font-mono text-blue-400">{cat}</span>
                          <span className="text-slate-500 truncate">{getCategoryLabel(cat)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Row: category + sort */}
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
                      className={`w-full text-left px-3 py-2 text-xs transition-colors ${!selectedCategory ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}>
                      All categories
                    </button>
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

              <button onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
                className="p-2 bg-slate-800 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 transition-all">
                {sortDir === 'desc' ? <SortDesc size={13} /> : <SortAsc size={13} />}
              </button>
            </div>

            {/* Author filter */}
            {showAuthorInput ? (
              <div className="relative">
                <User size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                <input type="text" value={authorFilter}
                  onChange={e => setAuthorFilter(e.target.value)}
                  placeholder="Filter by author…"
                  className="w-full bg-slate-800 text-slate-300 placeholder-slate-500 text-xs pl-7 pr-7 py-2 rounded-lg border border-amber-700/50 focus:outline-none focus:border-amber-500/70 transition-all"
                />
                <button onClick={() => { setAuthorFilter(''); setShowAuthorInput(false); }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button onClick={() => setShowAuthorInput(true)}
                className="w-full flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-400 transition-colors px-1">
                <User size={11} />
                Filter by author
              </button>
            )}

            {/* Assessment filter chips */}
            <div className="flex gap-1 flex-wrap">
              {ASSESSMENT_LEVELS.map(level => (
                <button key={level}
                  onClick={() => setAssessmentFilter(assessmentFilter === level ? '' : level)}
                  className={`text-[10px] font-semibold px-2 py-1 rounded-full border transition-all ${
                    assessmentFilter === level
                      ? ASSESSMENT_BADGE[level] + ' ring-1 ring-offset-1 ring-offset-slate-900 ring-current'
                      : 'bg-slate-800 text-slate-500 border-slate-700 hover:border-slate-500'
                  }`}>
                  {level}
                </button>
              ))}
            </div>

            {/* Active filter count + clear */}
            {activeFilterCount > 0 && (
              <button onClick={clearAllFilters}
                className="w-full text-[10px] text-slate-500 hover:text-red-400 transition-colors flex items-center gap-1 justify-center">
                <X size={10} />
                Clear {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''}
              </button>
            )}
          </div>
        )}

        {/* Count row */}
        <div className="px-4 py-2 border-b border-slate-800 flex items-center justify-between">
          <p className="text-[11px] text-slate-500">
            {displayPapers.length} of {totalCount} paper{totalCount !== 1 ? 's' : ''}
          </p>
          {activeView === 'inbox' && savedPapers.length > 0 && (
            <p className="text-[11px] text-slate-600">{savedPapers.length} saved</p>
          )}
        </div>

        {/* Paper list */}
        <div className="flex-1 overflow-y-auto custom-scroll">
          {activeView === 'inbox' && (
            <button onClick={() => setSelectedPaper(null)}
              className={`w-full text-left px-4 py-3 border-b border-slate-800/60 border-l-2 flex items-center gap-2.5 text-sm transition-all ${
                !selectedPaper && activeView === 'inbox'
                  ? 'bg-blue-600/20 border-l-blue-500 text-white'
                  : 'border-l-transparent text-slate-400 hover:bg-slate-800/40 hover:text-white'
              }`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4 shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
              Dashboard
            </button>
          )}

          {loading && displayPapers.length === 0 && (
            <div className="px-4 py-8 text-center text-slate-500 text-xs">Loading papers…</div>
          )}
          {activeView === 'library' && savedPapers.length === 0 && (
            <div className="px-4 py-10 text-center">
              <BookMarked size={28} className="mx-auto text-slate-700 mb-3" />
              <p className="text-slate-500 text-xs">No saved papers yet.</p>
              <p className="text-slate-600 text-[11px] mt-1">Bookmark papers from your inbox.</p>
            </div>
          )}
          {activeView === 'inbox' && !loading && displayPapers.length === 0 && papers.length > 0 && (
            <div className="px-4 py-8 text-center text-slate-500 text-xs">No papers match your filters.</div>
          )}

          {displayPapers.map(paper => (
            <PaperCard
              key={paper.id}
              paper={paper}
              isSelected={selectedPaper?.id === paper.id}
              isSaved={isSaved(paper.id)}
              onClick={() => setSelectedPaper(paper)}
            />
          ))}
        </div>
      </aside>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  );
}
