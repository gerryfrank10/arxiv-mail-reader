import { useState, useEffect } from 'react';
import AppRail from './AppRail';
import SearchOverlay from './SearchOverlay';
import Sidebar from './Sidebar';
import Dashboard from './Dashboard';
import PaperDetail from './PaperDetail';
import LibraryView from './LibraryView';
import DiscoverView from './DiscoverView';
import TrackingView from './TrackingView';
import BooksView from './BooksView';
import WriterView from './WriterView';
import CollectionsView from './CollectionsView';
import MagazineView from './MagazineView';
import AISuggestPanel from './AISuggestPanel';
import SettingsModal from './SettingsModal';
import { usePapers } from '../contexts/PapersContext';
import { LibraryProvider } from '../contexts/LibraryContext';
import { TrackingProvider } from '../contexts/TrackingContext';
import { BooksProvider } from '../contexts/BooksContext';
import { WriterProvider } from '../contexts/WriterContext';
import { CollectionsProvider } from '../contexts/CollectionsContext';
import { LinksProvider } from '../contexts/LinksContext';
import { ConfirmProvider } from '../contexts/ConfirmContext';
import { CorrelationsProvider } from '../contexts/CorrelationsContext';
import { MagazineProvider } from '../contexts/MagazineContext';

export type ActiveView = 'inbox' | 'library' | 'discover' | 'tracking' | 'books' | 'writer' | 'collections' | 'magazine';

function AppLayoutInner() {
  const { selectedPaper } = usePapers();
  const [activeView,    setActiveView]    = useState<ActiveView>('inbox');
  const [showAISuggest, setShowAISuggest] = useState(false);
  const [showSettings,  setShowSettings]  = useState(false);
  const [showSearch,    setShowSearch]    = useState(false);

  // Cmd+K / Ctrl+K opens the global search overlay from anywhere
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setShowSearch(true);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const mainContent = () => {
    if (selectedPaper) return <PaperDetail paper={selectedPaper} />;
    switch (activeView) {
      case 'tracking':    return <TrackingView />;
      case 'discover':    return <DiscoverView />;
      case 'library':     return <LibraryView />;
      case 'books':       return <BooksView />;
      case 'writer':      return <WriterView />;
      case 'collections': return <CollectionsView />;
      case 'magazine':    return <MagazineView />;
      default:            return <Dashboard />;
    }
  };

  // For Books/Writer the contextual sidebar is still useful (book list /
  // doc list), so we keep it. Only hide it if explicitly needed in future.
  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <AppRail
        activeView={activeView}
        setActiveView={setActiveView}
        onAISuggest={() => setShowAISuggest(true)}
        onSettings={() => setShowSettings(true)}
        onSearch={() => setShowSearch(true)}
      />
      <Sidebar activeView={activeView} setActiveView={setActiveView} />
      <main className="flex-1 overflow-hidden">
        {mainContent()}
      </main>
      {showAISuggest && <AISuggestPanel  onClose={() => setShowAISuggest(false)} />}
      {showSettings  && <SettingsModal   onClose={() => setShowSettings(false)} />}
      {showSearch    && <SearchOverlay   onClose={() => setShowSearch(false)} setActiveView={setActiveView} />}
    </div>
  );
}

export default function AppLayout() {
  return (
    <ConfirmProvider>
      <LibraryProvider>
        <TrackingProvider>
          <BooksProvider>
            <WriterProvider>
              <CollectionsProvider>
                <LinksProvider>
                  <CorrelationsProvider>
                    <MagazineProvider>
                      <AppLayoutInner />
                    </MagazineProvider>
                  </CorrelationsProvider>
                </LinksProvider>
              </CollectionsProvider>
            </WriterProvider>
          </BooksProvider>
        </TrackingProvider>
      </LibraryProvider>
    </ConfirmProvider>
  );
}
