import { Inbox, Compass, Target, BookMarked, Library, Pen, Sparkles, Settings, RefreshCw, FolderOpen, Newspaper, Activity, LogOut, ChevronsLeft, ChevronsRight, ChevronDown } from 'lucide-react';
import { useState, useRef, useEffect, useMemo } from 'react';
import { useAIActivity } from '../contexts/AIActivityContext';
import { ActiveView } from './AppLayout';
import { usePapers } from '../contexts/PapersContext';
import { useAuth } from '../contexts/AuthContext';
import { useLibrary } from '../contexts/LibraryContext';
import { useTracking } from '../contexts/TrackingContext';

interface Props {
  activeView: ActiveView;
  setActiveView: (v: ActiveView) => void;
  onAISuggest: () => void;
  onSettings: () => void;
  onActivity: () => void;
}interface RailItem {
  id:     ActiveView;
  icon:   React.ReactNode;
  label:  string;
  hint:   string;
  badge?: number | null;
  accent: 'blue' | 'indigo' | 'emerald' | 'amber' | 'cyan' | 'violet' | 'fuchsia' | 'rose';
}

// Static color maps so Tailwind's JIT picks up the classes
const ACCENT_BAR: Record<RailItem['accent'], string> = {
  blue:    'bg-blue-400',
  indigo:  'bg-indigo-400',
  emerald: 'bg-emerald-400',
  amber:   'bg-amber-400',
  cyan:    'bg-cyan-400',
  violet:  'bg-violet-400',
  fuchsia: 'bg-fuchsia-400',
  rose:    'bg-rose-400',
};
const ACCENT_BADGE: Record<RailItem['accent'], string> = {
  blue:    'bg-blue-500',
  indigo:  'bg-indigo-500',
  emerald: 'bg-emerald-500',
  amber:   'bg-amber-500',
  cyan:    'bg-cyan-500',
  violet:  'bg-violet-500',
  fuchsia: 'bg-fuchsia-500',
  rose:    'bg-rose-500',
};

const EXPANDED_KEY = 'rail.expanded';

export default function AppRail({ activeView, setActiveView, onAISuggest, onSettings, onActivity }: Props) {
  const { inFlight, paused } = useAIActivity();
  const { unreadCount, setSelectedPaper, sync, loading: syncing } = usePapers();
  const { savedPapers } = useLibrary();
  const { trackers, newMatchesByTracker, scoring } = useTracking();
  const { user, logout } = useAuth();

  const [expanded, setExpanded] = useState(() => {
    try { return localStorage.getItem(EXPANDED_KEY) === '1'; } catch { return false; }
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { localStorage.setItem(EXPANDED_KEY, expanded ? '1' : '0'); } catch { /* ignore */ }
  }, [expanded]);

  // Close the account menu on any click outside of it.
  useEffect(() => {
    if (!menuOpen) return;
    function onMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // Badge shows NEW (unseen) tracked papers — an actionable "you have N new
  // matches" alert — rather than the ever-growing total match count.
  const trackingNewCount = useMemo(
    () => trackers.reduce((sum, t) => sum + (t.enabled ? newMatchesByTracker(t.id).length : 0), 0),
    [trackers, newMatchesByTracker],
  );

  const readingItems: RailItem[] = [
    { id: 'inbox',    icon: <Inbox size={18} />, label: 'Inbox',    hint: 'Papers from your digests', badge: unreadCount || null,        accent: 'blue' },
    { id: 'discover', icon: <Compass size={18} />, label: 'Discover', hint: 'Search any research topic', badge: null,                     accent: 'indigo' },
    { id: 'tracking', icon: <Target size={18} className={scoring ? 'animate-pulse' : ''} />, label: 'Tracking', hint: 'Topics you follow', badge: trackingNewCount || null, accent: 'emerald' },
    { id: 'library',  icon: <BookMarked size={18} />, label: 'Library',  hint: 'Papers you saved', badge: savedPapers.length || null,         accent: 'amber' },
  ];
  const workspaceItems: RailItem[] = [
    { id: 'books',       icon: <Library    size={18} />, label: 'Books',       hint: 'Reading lists and books', badge: null, accent: 'cyan' },
    { id: 'collections', icon: <FolderOpen size={18} />, label: 'Collections', hint: 'Grouped papers by project', badge: null,  accent: 'fuchsia' },
    { id: 'magazine',    icon: <Newspaper  size={18} />, label: 'Magazine',    hint: 'Curated digest issues', badge: null,     accent: 'rose' },
    { id: 'writer',      icon: <Pen        size={18} />, label: 'Writer',      hint: 'Draft notes and documents', badge: null, accent: 'violet' },
  ];

  function pick(id: ActiveView) {
    setActiveView(id);
    setSelectedPaper(null);
  }

  const initials = (user?.email ?? '').split('@')[0].slice(0, 2).toUpperCase() || 'U';

  function renderItem(item: RailItem) {
    const active = activeView === item.id;
    return (
      <button
        key={item.id}
        onClick={() => pick(item.id)}
        title={expanded ? undefined : `${item.label} — ${item.hint}`}
        className={`group relative flex items-center rounded-xl transition-all ${
          expanded ? 'h-9 w-full gap-2.5 px-3' : 'h-10 w-10 mx-auto justify-center'
        } ${
          active
            ? 'bg-slate-800 text-white'
            : 'text-slate-400 hover:bg-slate-800 hover:text-white'
        }`}
      >
        {/* Active indicator: a coloured bar on the left edge */}
        <span className={`absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-full transition-all ${
          active ? ACCENT_BAR[item.accent] : 'bg-transparent'
        }`} />
        <span className="shrink-0 flex items-center justify-center">{item.icon}</span>
        {expanded && (
          <span className={`flex-1 min-w-0 truncate text-left text-[13px] ${active ? 'font-medium' : ''}`}>
            {item.label}
          </span>
        )}
        {item.badge != null && item.badge > 0 && (
          <span className={`text-[9px] font-bold px-1 min-w-[16px] h-4 rounded-full flex items-center justify-center text-white shrink-0 ${
            expanded ? '' : 'absolute -top-0.5 -right-0.5'
          } ${active ? ACCENT_BADGE[item.accent] : 'bg-slate-600'}`}>
            {item.badge > 99 ? '99+' : item.badge}
          </span>
        )}
        {/* Tooltip only in collapsed mode; labels make it redundant when expanded */}
        {!expanded && (
          <span className="absolute left-full ml-2 px-2 py-1 bg-slate-800 border border-slate-700 text-xs text-white whitespace-nowrap rounded-md opacity-0 group-hover:opacity-100 pointer-events-none transition-all translate-x-1 group-hover:translate-x-0 z-50 shadow-lg">
            {item.label} — {item.hint}
          </span>
        )}
      </button>
    );
  }

  function renderSectionLabel(text: string) {
    if (expanded) {
      return (
        <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 select-none">
          {text}
        </div>
      );
    }
    return <div className="mx-auto my-2 h-px w-8 bg-slate-700/70" />;
  }

  const menuPosition = expanded
    ? 'absolute bottom-full left-0 right-0 mb-2'
    : 'absolute bottom-0 left-full ml-2 w-56';

  return (
    <aside
      className={`shrink-0 h-full flex flex-col bg-slate-900 border-r border-slate-800 py-3 transition-[width] duration-200 overflow-hidden ${
        expanded ? 'w-[232px] px-2' : 'w-[68px] px-1.5 items-center'
      }`}
    >
      {/* Header: logo + expand toggle */}
      <div className={`flex items-center gap-2 mb-2 shrink-0 ${expanded ? 'w-full px-1' : 'flex-col'}`}>
        <div className="w-9 h-9 shrink-0 rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center text-white shadow-md shadow-blue-900/40">
          <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
          </svg>
        </div>
        {expanded ? (
          <>
            <span className="flex-1 min-w-0 truncate text-sm font-semibold text-white">arXiv Reader</span>
            <button
              onClick={() => setExpanded(false)}
              title="Collapse navigation"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-white hover:bg-slate-800 transition-all shrink-0"
            >
              <ChevronsLeft size={15} />
            </button>
          </>
        ) : (
          <button
            onClick={() => setExpanded(true)}
            title="Expand navigation"
            className="mt-1 w-8 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-white hover:bg-slate-800 transition-all"
          >
            <ChevronsRight size={15} />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className={`flex flex-col gap-0.5 w-full ${expanded ? '' : 'items-center'}`}>
        {renderSectionLabel('Reading')}
        {readingItems.map(renderItem)}
        {renderSectionLabel('Workspaces')}
        {workspaceItems.map(renderItem)}
      </nav>

      <div className="flex-1" />

      {/* AI activity — live status of background AI work */}
      <button
        onClick={onActivity}
        title={expanded ? undefined : `AI activity${paused ? ' · paused' : ''}${inFlight > 0 ? ` · ${inFlight} in flight` : ''}`}
        className={`group relative flex items-center rounded-xl transition-all ${
          expanded ? 'h-9 w-full gap-2.5 px-3' : 'h-10 w-10 mx-auto justify-center'
        } ${
          paused
            ? 'text-amber-300 hover:text-amber-200 hover:bg-slate-800'
            : 'text-slate-400 hover:text-white hover:bg-slate-800'
        }`}
      >
        <span className="shrink-0 flex items-center justify-center relative">
          <Activity size={17} className={inFlight > 0 ? 'animate-pulse' : ''} />
          {(inFlight > 0 || paused) && (
            <span className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ring-2 ring-slate-900 ${
              paused ? 'bg-amber-400' : 'bg-blue-400 animate-pulse'
            }`} />
          )}
        </span>
        {expanded && (
          <span className="flex-1 min-w-0 truncate text-left text-[13px]">
            AI activity{paused ? ' · paused' : inFlight > 0 ? ` · ${inFlight} running` : ''}
          </span>
        )}
        {!expanded && (
          <span className="absolute left-full ml-2 px-2 py-1 bg-slate-800 border border-slate-700 text-xs text-white whitespace-nowrap rounded-md opacity-0 group-hover:opacity-100 pointer-events-none transition-all translate-x-1 group-hover:translate-x-0 z-50 shadow-lg">
            AI activity{paused ? ' (paused)' : inFlight > 0 ? ` (${inFlight} running)` : ''}
          </span>
        )}
      </button>

      {/* Account: menu instead of accidental sign-out on click */}
      <div ref={menuRef} className={`relative mt-2 shrink-0 ${expanded ? 'w-full' : ''}`}>
        <button
          onClick={() => setMenuOpen(o => !o)}
          title={expanded ? undefined : `${user?.email ?? 'Account'} · account menu`}
          className={`group flex items-center rounded-xl transition-all ${
            expanded ? 'h-10 w-full gap-2.5 px-2' : 'w-10 h-10 mx-auto justify-center'
          } ${
            menuOpen ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <span className="w-7 h-7 shrink-0 rounded-full bg-slate-700 text-white text-[10px] font-semibold flex items-center justify-center">
            {initials}
          </span>
          {expanded && (
            <>
              <span className="flex-1 min-w-0 truncate text-left text-[13px]">{user?.email}</span>
              <ChevronDown size={14} className={`shrink-0 text-slate-500 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
            </>
          )}
          {!expanded && (
            <span className="absolute left-full ml-2 px-2 py-1 bg-slate-800 border border-slate-700 text-xs text-white whitespace-nowrap rounded-md opacity-0 group-hover:opacity-100 pointer-events-none transition-all translate-x-1 group-hover:translate-x-0 z-50 shadow-lg">
              Account
            </span>
          )}
        </button>

        {menuOpen && (
          <div className={`z-50 origin-bottom rounded-xl bg-slate-800 border border-slate-700 shadow-xl py-1.5 ${menuPosition}`}>
            <div className="px-3.5 py-1.5 border-b border-slate-700/70">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Signed in as</div>
              <div className="text-xs text-white truncate mt-0.5">{user?.email}</div>
            </div>
            <button
              onClick={() => { setMenuOpen(false); sync(true); }}
              disabled={syncing}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-slate-300 hover:bg-slate-700/60 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-wait"
            >
              <RefreshCw size={14} className={`text-slate-500 ${syncing ? 'animate-spin' : ''}`} /> Sync digests
            </button>
            <button
              onClick={() => { setMenuOpen(false); onAISuggest(); }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-slate-300 hover:bg-slate-700/60 hover:text-white transition-colors"
            >
              <Sparkles size={14} className="text-violet-400" /> AI suggestions
            </button>
            <button
              onClick={() => { setMenuOpen(false); onSettings(); }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-slate-300 hover:bg-slate-700/60 hover:text-white transition-colors"
            >
              <Settings size={14} className="text-slate-500" /> Settings
            </button>
            <div className="my-1 h-px bg-slate-700/70" />
            <button
              onClick={() => { setMenuOpen(false); logout(); }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-rose-300 hover:bg-rose-900/40 hover:text-rose-200 transition-colors"
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
