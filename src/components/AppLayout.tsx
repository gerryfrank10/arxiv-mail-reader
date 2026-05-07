import { useState } from 'react';
import Sidebar from './Sidebar';
import Dashboard from './Dashboard';
import PaperDetail from './PaperDetail';
import LibraryView from './LibraryView';
import { usePapers } from '../contexts/PapersContext';
import { LibraryProvider } from '../contexts/LibraryContext';

export type ActiveView = 'inbox' | 'library';

function AppLayoutInner() {
  const { selectedPaper } = usePapers();
  const [activeView, setActiveView] = useState<ActiveView>('inbox');

  function handleSelectPaper(p: import('../types').Paper | null) {
    // Expose via usePapers setter — just set it
    // (selectedPaper setter is in context)
    void p; // used by Sidebar directly
  }
  void handleSelectPaper;

  const mainContent = () => {
    if (selectedPaper) return <PaperDetail paper={selectedPaper} />;
    if (activeView === 'library') return <LibraryView />;
    return <Dashboard />;
  };

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar activeView={activeView} setActiveView={setActiveView} />
      <main className="flex-1 overflow-hidden">
        {mainContent()}
      </main>
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
