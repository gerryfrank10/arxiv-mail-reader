import { useState } from 'react';
import Sidebar from './Sidebar';
import Dashboard from './Dashboard';
import PaperDetail from './PaperDetail';
import LibraryView from './LibraryView';
import DiscoverView from './DiscoverView';
import AISuggestPanel from './AISuggestPanel';
import { usePapers } from '../contexts/PapersContext';
import { LibraryProvider } from '../contexts/LibraryContext';

export type ActiveView = 'inbox' | 'library' | 'discover';

function AppLayoutInner() {
  const { selectedPaper } = usePapers();
  const [activeView, setActiveView] = useState<ActiveView>('inbox');
  const [showAISuggest, setShowAISuggest] = useState(false);

  const mainContent = () => {
    if (selectedPaper) return <PaperDetail paper={selectedPaper} />;
    if (activeView === 'discover') return <DiscoverView />;
    if (activeView === 'library')  return <LibraryView />;
    return <Dashboard />;
  };

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar activeView={activeView} setActiveView={setActiveView} onAISuggest={() => setShowAISuggest(true)} />
      <main className="flex-1 overflow-hidden">
        {mainContent()}
      </main>
      {showAISuggest && <AISuggestPanel onClose={() => setShowAISuggest(false)} />}
    </div>
  );
}

export default function AppLayout() {
  return (
    <LibraryProvider>
      <AppLayoutInner />
    </LibraryProvider>
  );
}
