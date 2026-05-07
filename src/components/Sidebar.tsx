import { Search, RefreshCw, Settings, LogOut, ChevronDown, SortAsc, SortDesc, Inbox, BookMarked } from 'lucide-react';
import { useState } from 'react';
import { usePapers } from '../contexts/PapersContext';
import { useAuth } from '../contexts/AuthContext';
import { useLibrary } from '../contexts/LibraryContext';
import PaperCard from './PaperCard';
import SettingsModal from './SettingsModal';
import { ActiveView } from './AppLayout';
import { SortField } from '../types';

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

export default function Sidebar({ activeView, setActiveView }: Props) {
  const {
    filteredPapers, papers, loading, progress, error,
    selectedPaper, setSelectedPaper,
    searchQuery, setSearchQuery,
    selectedCategory, setSelectedCategory,
    allCategories, sync,
    sortBy, setSortBy, sortDir, setSortDir,
  } = usePapers();
  const { user, logout } = useAuth();
  const { savedPapers, isSaved } = useLibrary();
  const [showSettings, setShowSettings] = useState(false);
  const [showCatMenu, setShowCatMenu]   = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);

  const displayPapers = activeView === 'library' ? savedPapers : filteredPapers;
  const totalCount    = activeView === 'library' ? savedPapers.length : papers.length;

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
              <span className="text-sm font-semibold text-white">arXiv Reader</span>
            </div>
            <div className="flex items-center gap-1">
              {activeView === 'inbox' && (
                <button
                  onClick={() => sync(true)}
                  disabled={loading}
                  title="Sync emails"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all disabled:opacity-50"
                >
                  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </button>
              )}
              <button
                onClick={() => setShowSettings(true)}
                title="Settings"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
              >
                <Settings size={14} />
              </button>
              <button
                onClick={logout}
                title="Sign out"
                className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-all"
              >
                <LogOut size={14} />
              </button>
            </div>
          </div>
          {user?.email && (
            <p className="text-[11px] text-slate-500 truncate mt-1">{user.email}</p>
          )}
        </div>

        {/* Loading bar */}
        {loading && (
          <div className="h-0.5 bg-slate-800">
            <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        )}

        {error && (
          <div className="mx-3 mt-3 px-3 py-2 rounded-lg bg-red-900/30 border border-red-800 text-red-400 text-xs">
            {error}
          </div>
        )}

        {/* Inbox / Library tabs */}
        <div className="flex border-b border-slate-800">
          <button
            onClick={() => setActiveView('inbox')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-all ${
              activeView === 'inbox'
                ? 'text-white border-b-2 border-blue-500 bg-slate-800/30'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <Inbox size={13} />
            Inbox
            {papers.length > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${activeView === 'inbox' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
                {papers.length}
              </span>
            )}
          </button>
          <button
            onClick={() => { setActiveView('library'); setSelectedPaper(null); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-all ${
              activeView === 'library'
                ? 'text-white border-b-2 border-amber-500 bg-slate-800/30'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
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
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search papers…"
                className="w-full bg-slate-800 text-slate-300 placeholder-slate-500 text-xs pl-7 pr-3 py-2 rounded-lg border border-slate-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all"
              />
            </div>

            <div className="flex gap-2">
              {/* Category filter */}
              <div className="relative flex-1">
                <button
                  onClick={() => { setShowCatMenu(v => !v); setShowSortMenu(false); }}
                  className="w-full flex items-center justify-between bg-slate-800 text-xs text-slate-400 px-2.5 py-2 rounded-lg border border-slate-700 hover:border-slate-600 transition-all"
                >
                  <span className="truncate">{selectedCategory || 'Category'}</span>
                  <ChevronDown size={11} className={`ml-1 shrink-0 transition-transform ${showCatMenu ? 'rotate-180' : ''}`} />
                </button>
                {showCatMenu && (
                  <div className="absolute top-full left-0 right-0 mt-1 z-30 bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden max-h-48 overflow-y-auto custom-scroll">
                    <button
                      onClick={() => { setSelectedCategory(''); setShowCatMenu(false); }}
                      className={`w-full text-left px-3 py-2 text-xs transition-colors ${!selectedCategory ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
                    >
                      All categories
                    </button>
                    {allCategories.map(cat => (
                      <button
                        key={cat}
                        onClick={() => { setSelectedCategory(cat); setShowCatMenu(false); }}
                        className={`w-full text-left px-3 py-2 text-xs transition-colors ${selectedCategory === cat ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Sort control */}
              <div className="relative">
                <button
                  onClick={() => { setShowSortMenu(v => !v); setShowCatMenu(false); }}
                  className="flex items-center gap-1 bg-slate-800 text-xs text-slate-400 px-2.5 py-2 rounded-lg border border-slate-700 hover:border-slate-600 transition-all"
                >
                  {sortDir === 'desc' ? <SortDesc size={13} /> : <SortAsc size={13} />}
                  <span>{SORT_OPTIONS.find(o => o.value === sortBy)?.label}</span>
                </button>
                {showSortMenu && (
                  <div className="absolute top-full right-0 mt-1 z-30 w-36 bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden">
                    {SORT_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          if (sortBy === opt.value) {
                            setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
                          } else {
                            setSortBy(opt.value);
                            setSortDir(opt.value === 'title' || opt.value === 'authors' ? 'asc' : 'desc');
                          }
                          setShowSortMenu(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition-colors ${sortBy === opt.value ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
                      >
                        {opt.label}
                        {sortBy === opt.value && (
                          sortDir === 'desc' ? <SortDesc size={11} /> : <SortAsc size={11} />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
                title="Toggle sort direction"
                className="p-2 bg-slate-800 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 transition-all"
              >
                {sortDir === 'desc' ? <SortDesc size={13} /> : <SortAsc size={13} />}
              </button>
            </div>
          </div>
        )}

        {/* Count row */}
        <div className="px-4 py-2 border-b border-slate-800 flex items-center justify-between">
          <p className="text-[11px] text-slate-500">
            {displayPapers.length} of {totalCount} paper{totalCount !== 1 ? 's' : ''}
          </p>
          {activeView === 'inbox' && papers.length > 0 && (
            <p className="text-[11px] text-slate-600">
              {savedPapers.length} saved
            </p>
          )}
        </div>

        {/* Paper list */}
        <div className="flex-1 overflow-y-auto custom-scroll">
          {/* Dashboard shortcut (inbox only) */}
          {activeView === 'inbox' && (
            <button
              onClick={() => setSelectedPaper(null)}
              className={`w-full text-left px-4 py-3 border-b border-slate-800/60 border-l-2 flex items-center gap-2.5 text-sm transition-all ${
                !selectedPaper && activeView === 'inbox'
                  ? 'bg-blue-600/20 border-l-blue-500 text-white'
                  : 'border-l-transparent text-slate-400 hover:bg-slate-800/40 hover:text-white'
              }`}
            >
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
              <p className="text-slate-600 text-[11px] mt-1">Bookmark papers from your inbox to save them here.</p>
            </div>
          )}

          {activeView === 'inbox' && !loading && displayPapers.length === 0 && papers.length > 0 && (
            <div className="px-4 py-8 text-center text-slate-500 text-xs">No papers match your search.</div>
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
