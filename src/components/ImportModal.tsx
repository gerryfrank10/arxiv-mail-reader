import { useState, useRef } from 'react';
import { X, Upload, FileText, Plus, Loader2, AlertCircle, CheckCircle2, FileUp } from 'lucide-react';
import { usePapers } from '../contexts/PapersContext';
import {
  extractArxivIds,
  fetchArxivMetadata,
  metadataToPaper,
  parseBibtex,
  bibEntryToPaper,
} from '../utils/paperImport';
import { Paper } from '../types';

interface Props {
  onClose: () => void;
}

type Tab = 'single' | 'bulk' | 'bibtex';

interface ProgressState {
  done: number;
  total: number;
  failures: Array<{ id: string; reason: string }>;
}

export default function ImportModal({ onClose }: Props) {
  const { addImportedPapers } = usePapers();
  const [tab, setTab]       = useState<Tab>('single');
  const [busy, setBusy]     = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [result, setResult] = useState<{ added: number; duplicates: number; failed: number } | null>(null);
  const [error, setError]   = useState<string | null>(null);

  // single
  const [singleInput, setSingleInput] = useState('');
  // bulk
  const [bulkInput, setBulkInput]     = useState('');
  // bibtex
  const [bibText, setBibText]         = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  function reset() {
    setBusy(false);
    setProgress(null);
    setError(null);
    setResult(null);
  }

  async function importFromArxivIds(ids: string[]) {
    if (ids.length === 0) {
      setError('No valid arXiv IDs found in the input.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    setProgress({ done: 0, total: ids.length, failures: [] });
    const papers: Paper[] = [];
    const failures: Array<{ id: string; reason: string }> = [];

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      try {
        const meta = await fetchArxivMetadata(id);
        papers.push(metadataToPaper(meta));
      } catch (e) {
        failures.push({ id, reason: e instanceof Error ? e.message : 'failed' });
      }
      setProgress({ done: i + 1, total: ids.length, failures: [...failures] });
    }

    const { added, duplicates } = await addImportedPapers(papers);
    setResult({ added, duplicates, failed: failures.length });
    setBusy(false);
  }

  async function handleSingle() {
    const ids = extractArxivIds(singleInput.trim());
    if (ids.length === 0) {
      setError('Could not find an arXiv ID in that input. Paste an ID like 2402.05576 or a full arxiv.org URL.');
      return;
    }
    await importFromArxivIds(ids.slice(0, 1));
  }

  async function handleBulk() {
    const ids = extractArxivIds(bulkInput);
    if (ids.length === 0) {
      setError('No arXiv IDs found in the input. Paste one per line, or any text containing arxiv.org URLs.');
      return;
    }
    await importFromArxivIds(ids);
  }

  async function handleBibtex() {
    const entries = parseBibtex(bibText);
    if (entries.length === 0) {
      setError('No BibTeX entries found. Did you upload a .bib file?');
      return;
    }
    // First: collect papers we can build offline from BibTeX fields
    const offlinePapers: Paper[] = [];
    const needsFetch: string[]   = [];
    for (const e of entries) {
      const offline = bibEntryToPaper(e);
      if (offline) {
        // If the entry has its own abstract, we can use it as-is. Otherwise
        // queue an arxiv API fetch to enrich the record.
        if (offline.abstract) offlinePapers.push(offline);
        else                   needsFetch.push(offline.arxivId);
      } else {
        // No arXiv id in the entry — skip with a recorded failure
        // (we'll surface this at the end)
      }
    }

    setBusy(true);
    setError(null);
    setProgress({ done: 0, total: needsFetch.length, failures: [] });
    const fetched: Paper[] = [];
    const failures: Array<{ id: string; reason: string }> = [];
    for (let i = 0; i < needsFetch.length; i++) {
      const id = needsFetch[i];
      try {
        const meta = await fetchArxivMetadata(id);
        fetched.push(metadataToPaper(meta));
      } catch (e) {
        failures.push({ id, reason: e instanceof Error ? e.message : 'failed' });
      }
      setProgress({ done: i + 1, total: needsFetch.length, failures: [...failures] });
    }

    const allPapers = [...offlinePapers, ...fetched];
    const { added, duplicates } = await addImportedPapers(allPapers);
    setResult({
      added,
      duplicates,
      failed: failures.length + (entries.length - allPapers.length - failures.length),
    });
    setBusy(false);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    setBibText(text);
    setTab('bibtex');
  }

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: 'single', label: 'Single paper',   icon: <Plus size={13} /> },
    { id: 'bulk',   label: 'Bulk paste',     icon: <FileText size={13} /> },
    { id: 'bibtex', label: 'BibTeX (.bib)',  icon: <FileUp size={13} /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl p-6 max-h-[92vh] overflow-y-auto fade-in">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <Upload size={18} className="text-blue-500" />
            Import papers
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1 mb-5 w-fit">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); reset(); }}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-sm font-medium transition-all ${
                tab === t.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        {tab === 'single' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">arXiv ID or URL</label>
            <input
              type="text"
              autoFocus
              value={singleInput}
              onChange={e => setSingleInput(e.target.value)}
              placeholder="e.g. 2402.05576 or https://arxiv.org/abs/2402.05576"
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all"
              onKeyDown={e => { if (e.key === 'Enter' && !busy) handleSingle(); }}
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Accepts plain IDs, versioned IDs, abs/pdf/html URLs, even export.arxiv.org links.
            </p>
          </div>
        )}

        {tab === 'bulk' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Paste anything containing arXiv IDs</label>
            <textarea
              value={bulkInput}
              onChange={e => setBulkInput(e.target.value)}
              rows={8}
              placeholder={`2402.05576\nhttps://arxiv.org/abs/2305.10403\n1706.03762\narXiv:2403.04706\n…`}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all resize-y"
            />
            {!busy && bulkInput.trim() && (
              <p className="mt-1.5 text-xs text-slate-500">
                Detected <span className="font-semibold text-slate-700">{extractArxivIds(bulkInput).length}</span> arXiv ID{extractArxivIds(bulkInput).length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        )}

        {tab === 'bibtex' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">BibTeX content</label>
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => fileInput.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <FileUp size={12} />
                Upload .bib file
              </button>
              <input ref={fileInput} type="file" accept=".bib,.bibtex,text/plain" onChange={handleFile} className="hidden" />
              <span className="text-xs text-slate-400">or paste below</span>
            </div>
            <textarea
              value={bibText}
              onChange={e => setBibText(e.target.value)}
              rows={10}
              placeholder={`@article{vaswani2017attention,\n  title={Attention is All You Need},\n  author={Vaswani, Ashish and …},\n  eprint={1706.03762},\n  archivePrefix={arXiv}\n}`}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all resize-y"
            />
            {!busy && bibText.trim() && (
              <p className="mt-1.5 text-xs text-slate-500">
                Detected <span className="font-semibold text-slate-700">{parseBibtex(bibText).length}</span> BibTeX entr{parseBibtex(bibText).length === 1 ? 'y' : 'ies'}
              </p>
            )}
          </div>
        )}

        {/* Progress */}
        {progress && (
          <div className="mt-5 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800">
            <div className="flex items-center gap-2 mb-1">
              <Loader2 size={14} className={busy ? 'animate-spin' : ''} />
              <span>Fetched {progress.done} / {progress.total} from arXiv</span>
              {progress.failures.length > 0 && (
                <span className="text-amber-600 ml-2">({progress.failures.length} failed)</span>
              )}
            </div>
            <div className="h-1.5 bg-blue-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-4 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-start gap-2">
            <AlertCircle size={15} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Result */}
        {result && !busy && (
          <div className="mt-4 px-3 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-start gap-2">
            <CheckCircle2 size={15} className="shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium">
                Added <span className="font-bold">{result.added}</span> new paper{result.added !== 1 ? 's' : ''}
                {result.duplicates > 0 && <> · {result.duplicates} already in inbox</>}
                {result.failed > 0     && <> · {result.failed} failed</>}
              </p>
              {progress?.failures && progress.failures.length > 0 && (
                <ul className="text-xs mt-1 text-emerald-700/80">
                  {progress.failures.slice(0, 5).map(f => (
                    <li key={f.id} className="font-mono">{f.id} — {f.reason}</li>
                  ))}
                  {progress.failures.length > 5 && <li>… and {progress.failures.length - 5} more</li>}
                </ul>
              )}
            </div>
          </div>
        )}

        <div className="mt-6 flex gap-3 items-center">
          <div className="flex-1" />
          <button onClick={onClose} className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
            {result ? 'Done' : 'Cancel'}
          </button>
          <button
            onClick={tab === 'single' ? handleSingle : tab === 'bulk' ? handleBulk : handleBibtex}
            disabled={busy}
            className="px-5 py-2.5 bg-blue-600 rounded-lg text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
