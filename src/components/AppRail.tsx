import { Inbox, Compass, Target, BookMarked, Library, Pen, Sparkles, Settings, RefreshCw } from 'lucide-react';
import { ActiveView } from './AppLayout';
import { usePapers } from '../contexts/PapersContext';
import { useAuth } from '../contexts/AuthContext';
import { useLibrary } from '../contexts/LibraryContext';
import { useTracking } from '../contexts/TrackingContext';
import { useMemo } from 'react';

interface Props {
  activeView: ActiveView;
  setActiveView: (v: ActiveView) => void;
  onAISuggest: () => void;
  onSettings: () => void;
}

interface RailItem {
  id:     ActiveView;
  icon:   React.ReactNode;
  label:  string;
  badge?: number | null;
  accent: 'blue' | 'indigo' | 'emerald' | 'amber' | 'cyan' | 'violet';
}

// Static color maps so Tailwind's JIT picks up the classes
const ACCENT_BAR: Record<RailItem['accent'], string> = {
  blue:    'bg-blue-400',
  indigo:  'bg-indigo-400',
  emerald: 'bg-emerald-400',
  amber:   'bg-amber-400',
  cyan:    'bg-cyan-400',
  violet:  'bg-violet-400',
};
const ACCENT_BADGE: Record<RailItem['accent'], string> = {
  blue:    'bg-blue-500',
  indigo:  'bg-indigo-500',
  emerald: 'bg-emerald-500',
  amber:   'bg-amber-500',
  cyan:    'bg-cyan-500',
  violet:  'bg-violet-500',
};

export default function AppRail({ activeView, setActiveView, onAISuggest, onSettings }: Props) {
  const { unreadCount, loading, sync, setSelectedPaper } = usePapers();
  const { savedPapers } = useLibrary();
  const { trackers, matchesByTracker, scoring } = useTracking();
  const { user, logout } = useAuth();

  const trackingMatchCount = useMemo(
    () => trackers.reduce((sum, t) => sum + matchesByTracker(t.id).length, 0),
    [trackers, matchesByTracker],
  );

  const items: RailItem[] = [
    { id: 'inbox',    icon: <Inbox      size={18} />, label: 'Inbox',    badge: unreadCount || null,        accent: 'blue' },
    { id: 'discover', icon: <Compass    size={18} />, label: 'Discover', badge: null,                       accent: 'indigo' },
    { id: 'tracking', icon: <Target     size={18} className={scoring ? 'animate-pulse' : ''} />, label: 'Tracking', badge: trackingMatchCount || null, accent: 'emerald' },
    { id: 'library',  icon: <BookMarked size={18} />, label: 'Library',  badge: savedPapers.length || null, accent: 'amber' },
    { id: 'books',    icon: <Library    size={18} />, label: 'Books',    badge: null,                       accent: 'cyan' },
    { id: 'writer',   icon: <Pen        size={18} />, label: 'Writer',   badge: null,                       accent: 'violet' },
  ];

  function pick(id: ActiveView) {
    setActiveView(id);
    setSelectedPaper(null);
  }

  const initials = (user?.email ?? '').split('@')[0].slice(0, 2).toUpperCase() || 'U';

  return (
    <aside className="w-[68px] shrink-0 h-full flex flex-col items-center bg-slate-900 border-r border-slate-800 py-3 gap-1">
      {/* Logo */}
      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center text-white mb-2 shadow-md shadow-blue-900/40">
        <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
        </svg>
      </div>

      {/* Workspace tabs */}
      <div className="flex flex-col gap-1 mt-1">
        {items.map(item => {
          const active = activeView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => pick(item.id)}
              className={`group relative w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
                active
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
              title={item.label}
            >
              {/* Active indicator: a coloured bar on the left edge */}
              <span className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-r-full transition-all ${
                active ? ACCENT_BAR[item.accent] : 'bg-transparent'
              }`} />
              {item.icon}
              {item.badge != null && item.badge > 0 && (
                <span className={`absolute -top-0.5 -right-0.5 text-[9px] font-bold px-1 min-w-[16px] h-4 rounded-full flex items-center justify-center text-white ${
                  active ? ACCENT_BADGE[item.accent] : 'bg-slate-600'
                }`}>
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
              {/* Tooltip */}
              <span className="absolute left-full ml-2 px-2 py-1 bg-slate-800 border border-slate-700 text-xs text-white whitespace-nowrap rounded-md opacity-0 group-hover:opacity-100 pointer-events-none transition-all translate-x-1 group-hover:translate-x-0 z-50 shadow-lg">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex-1" />

      {/* Sync + AI suggest + Settings */}
      <button
        onClick={() => sync(true)}
        disabled={loading}
        title="Sync digests"
        className="w-10 h-10 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
      </button>
      <button
        onClick={onAISuggest}
        title="AI suggestions"
        className="w-10 h-10 rounded-lg flex items-center justify-center text-violet-400 hover:text-violet-300 hover:bg-slate-800 transition-all"
      >
        <Sparkles size={14} />
      </button>
      <button
        onClick={onSettings}
        title="Settings"
        className="w-10 h-10 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
      >
        <Settings size={14} />
      </button>

      {/* Profile / logout */}
      <button
        onClick={logout}
        title={`${user?.email ?? 'Sign out'} · click to sign out`}
        className="mt-1 w-9 h-9 rounded-full bg-slate-700 text-white text-[11px] font-semibold flex items-center justify-center hover:bg-red-700 transition-colors"
      >
        {initials}
      </button>
    </aside>
  );
}
