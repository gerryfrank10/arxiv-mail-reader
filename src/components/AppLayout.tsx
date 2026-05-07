import Sidebar from './Sidebar';
import Dashboard from './Dashboard';
import PaperDetail from './PaperDetail';
import { usePapers } from '../contexts/PapersContext';

export default function AppLayout() {
  const { selectedPaper } = usePapers();

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        {selectedPaper ? <PaperDetail paper={selectedPaper} /> : <Dashboard />}
      </main>
    </div>
  );
}
