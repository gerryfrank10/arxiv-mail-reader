import { useState } from 'react';
import AppRail from './AppRail';
import Sidebar from './Sidebar';
import Dashboard from './Dashboard';
import PaperDetail from './PaperDetail';
import LibraryView from './LibraryView';
import DiscoverView from './DiscoverView';
import TrackingView from './TrackingView';
import BooksView from './BooksView';
import WriterView from './WriterView';
import CollectionsView from './CollectionsView';
import AISuggestPanel from './AISuggestPanel';
import SettingsModal from './SettingsModal';
import { usePapers } from '../contexts/PapersContext';
import { LibraryProvider } from '../contexts/LibraryContext';
import { TrackingProvider } from '../contexts/TrackingContext';
import { BooksProvider } from '../contexts/BooksContext';
import { WriterProvider } from '../contexts/WriterContext';
import { CollectionsProvider } from '../contexts/CollectionsContext';
import { LinksProvider } from '../contexts/LinksContext';

export type ActiveView = 'inbox' | 'library' | 'discover' | 'tracking' | 'books' | 'writer' | 'collections';

function AppLayoutInner() {
  const { selectedPaper } = usePapers();
  const [activeView,    setActiveView]    = useState<ActiveView>('inbox');
  const [showAISuggest, setShowAISuggest] = useState(false);
  const [showSettings,  setShowSettings]  = useState(false);

  const mainContent = () => {
    if (selectedPaper) return <PaperDetail paper={selectedPaper} />;
    switch (activeView) {
      case 'tracking':    return <TrackingView />;
      case 'discover':    return <DiscoverView />;
      case 'library':     return <LibraryView />;
      case 'books':       return <BooksView />;
      case 'writer':      return <WriterView />;
      case 'collections': return <CollectionsView />;
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
      />
      <Sidebar activeView={activeView} setActiveView={setActiveView} />
      <main className="flex-1 overflow-hidden">
        {mainContent()}
      </main>
      {showAISuggest && <AISuggestPanel  onClose={() => setShowAISuggest(false)} />}
      {showSettings  && <SettingsModal   onClose={() => setShowSettings(false)} />}
    </div>
  );
}

export default function AppLayout() {
  return (
    <LibraryProvider>
      <TrackingProvider>
        <BooksProvider>
          <WriterProvider>
            <CollectionsProvider>
              <LinksProvider>
                <AppLayoutInner />
              </LinksProvider>
            </CollectionsProvider>
          </WriterProvider>
        </BooksProvider>
      </TrackingProvider>
    </LibraryProvider>
  );
}
