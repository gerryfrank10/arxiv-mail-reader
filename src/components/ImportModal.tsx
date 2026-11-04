import { useState, useRef, useEffect } from 'react';
import { X, Upload, FileText, Plus, Loader2, AlertCircle, CheckCircle2, FileUp, Search, File as FileIcon, History, Pause, Play, XCircle } from 'lucide-react';
import { usePapers } from '../contexts/PapersContext';
import {
  extractArxivIds,
  fetchArxivMetadataBatch,
  fetchArxivBySearch,
  metadataToPaper,
  parseBibtex,
  bibEntryToPaper,
  type ArxivSearchMode,
} from '../utils/paperImport';
import {
  uploadPaperFile,
  apiListIngestJobs,
  apiCreateArxivHistoryJob,
  apiControlIngestJob,
  type IngestJob,
} from '../utils/researchApi';
import { Paper } from '../types';

interface Props {
  onClose: () => void;
}

type Tab = 'single' | 'bulk' | 'bibtex' | 'arxiv' | 'history' | 'upload';

// A few common arXiv categories offered as autocomplete suggestions.
const COMMON_CATEGORIES = [
  'cs.LG', 'cs.AI', 'cs.CL', 'cs.CV', 'cs.CR', 'cs.RO', 'cs.DC', 'cs.HC', 'cs.SE',
  'stat.ML', 'math.OC', 'math.AP', 'eess.SP', 'eess.IV',
  'q-bio.NC', 'q-fin.TR', 'econ.EM', 'astro-ph.GA', 'hep-th', 'cond-mat.stat-mech',
];

interface ProgressState {
  done: number;
  total: number;
  failures: Array<{ id: string; reason: string }>;
  label: 'arXiv' | 'PDFs';
}

interface ImportResult {
  added: number;
  duplicates: number;
  failed: number;
  papers: Paper[];
}

export default function ImportModal({ onClose }: Props) {
  const { addImportedPapers, storageMode, setSelectedPaper, reloadPapers } = usePapers();
  const [tab, setTab]       = useState<Tab>('single');
  const [busy, setBusy]     = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError]   = useState<string | null>(null);

  // single
  const [singleInput, setSingleInput] = useState('');
  // bulk
  const [bulkInput, setBulkInput]     = useState('');
  // bibtex
  const [bibText, setBibText]         = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  // upload local PDFs
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const pdfInput = useRef<HTMLInputElement>(null);
  // from arXiv (bulk discover)
  const [arxivMode,  setArxivMode]  = useState<ArxivSearchMode>('category');
  const [arxivValue, setArxivValue] = useState('');
  const [arxivFrom,  setArxivFrom]  = useState('');
  const [arxivTo,    setArxivTo]    = useState('');
  const [arxivMax,   setArxivMax]   = useState(100);
  // durable historical import
  const [historyCategories, setHistoryCategories] = useState('');
  const [historyFromYear, setHistoryFromYear] = useState(2000);
  const [historyToYear, setHistoryToYear] = useState(new Date().getFullYear());
  const [historyJobs, setHistoryJobs] = useState<IngestJob[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const refreshedJobs = useRef(new Set<string>());

  useEffect(() => {
    if (tab !== 'history') return;
    let disposed = false;
    let timer: number | undefined;
    const refreshJobs = async () => {
      try {
        const jobs = await apiListIngestJobs();
        if (!disposed) {
          setHistoryJobs(jobs);
          const newlyCompleted = jobs.some(job => job.status === 'completed' && !refreshedJobs.current.has(job.id));
          if (newlyCompleted) {
            for (const job of jobs) if (job.status === 'completed') refreshedJobs.current.add(job.id);
            void reloadPapers();
          }
        }
      } catch (e) {
        if (!disposed) setHistoryError(e instanceof Error ? e.message : 'Could not load import jobs.');
      } finally {
        if (!disposed) timer = window.setTimeout(refreshJobs, 4000);
      }
    };
    void refreshJobs();
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [tab, reloadPapers]);

  async function startHistoryImport() {
    const categories = historyCategories.split(',').map(c => c.trim()).filter(Boolean);
    if (categories.length === 0) {
      setHistoryError('Enter one or more arXiv categories, such as cs.AI, cs.LG.');
      return;
    }
    setHistoryBusy(true);
    setHistoryError('');
    try {
      const job = await apiCreateArxivHistoryJob({ categories, fromYear: historyFromYear, toYear: historyToYear });
      setHistoryJobs(prev => [job, ...prev.filter(j => j.id !== job.id)]);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : 'Could not start the import.');
    } finally {
      setHistoryBusy(false);
    }
  }

  async function controlHistoryJob(id: string, action: 'pause' | 'resume' | 'cancel') {
    try {
      const updated = await apiControlIngestJob(id, action);
      setHistoryJobs(prev => prev.map(j => j.id === id ? updated : j));
      setHistoryError('');
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : `Could not ${action} the job.`);
    }
  }

  function reset() {
    setBusy(false);
    setProgress(null);
    setError(null);
    setResult(null);
    setUploadFiles([]);
  }

  async function importFromArxivIds(ids: string[]) {
    if (ids.length === 0) {
      setError('No valid arXiv IDs found in the input.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    setProgress({ done: 0, total: ids.length, failures: [], label: 'arXiv' });
    const papers: Paper[] = [];
    const failures: Array<{ id: string; reason: string }> = [];

    // Batch into one arXiv call per CHUNK of 25 ids — avoids the 429s that
    // one-request-per-paper used to trigger.
    const CHUNK = 25;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      try {
        const { results, errors } = await fetchArxivMetadataBatch(chunk);
        for (const id of chunk) {
          // The server keys results by canonical arxivId (version stripped),
          // so normalise the requested id the same way before lookup.
          const canonical = id.replace(/v\d+$/i, '');
          const meta = results[canonical] ?? results[id];
          if (meta) papers.push(metadataToPaper(meta));
          else      failures.push({ id, reason: errors[canonical] ?? errors[id] ?? 'not found' });
        }
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'batch failed';
        for (const id of chunk) failures.push({ id, reason });
      }
      setProgress({ done: Math.min(i + CHUNK, ids.length), total: ids.length, failures: [...failures], label: 'arXiv' });
    }

    try {
      const { added, duplicates, addedPapers } = await addImportedPapers(papers);
      setResult({ added, duplicates, failed: failures.length, papers: addedPapers });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the imported papers.');
    } finally {
      setBusy(false);
    }
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
    setProgress({ done: 0, total: needsFetch.length, failures: [], label: 'arXiv' });
    const fetched: Paper[] = [];
    const failures: Array<{ id: string; reason: string }> = [];
    // Enrich abstract-less BibTeX entries via the batch endpoint (one arXiv
    // call per 25 ids) instead of one request each.
    const CHUNK = 25;
    for (let i = 0; i < needsFetch.length; i += CHUNK) {
      const chunk = needsFetch.slice(i, i + CHUNK);
      try {
        const { results, errors } = await fetchArxivMetadataBatch(chunk);
        for (const id of chunk) {
          const canonical = id.replace(/v\d+$/i, '');
          const meta = results[canonical] ?? results[id];
          if (meta) fetched.push(metadataToPaper(meta));
          else      failures.push({ id, reason: errors[canonical] ?? errors[id] ?? 'not found' });
        }
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'batch failed';
        for (const id of chunk) failures.push({ id, reason });
      }
      setProgress({ done: Math.min(i + CHUNK, needsFetch.length), total: needsFetch.length, failures: [...failures], label: 'arXiv' });
    }

    const allPapers = [...offlinePapers, ...fetched];
    try {
      const { added, duplicates, addedPapers } = await addImportedPapers(allPapers);
      setResult({
        added,
        duplicates,
        failed: failures.length + (entries.length - allPapers.length - failures.length),
        papers: addedPapers,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the imported papers.');
    } finally {
      setBusy(false);
    }
  }

  async function handleArxiv() {
    const value = arxivValue.trim();
    if (!value) {
      setError(`Enter a ${arxivMode === 'category' ? 'category' : arxivMode === 'author' ? 'author name' : 'keyword'} to search.`);
      return;
    }
    if (arxivFrom && arxivTo && arxivFrom > arxivTo) {
      setError('The "from" date is after the "to" date.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      const { results } = await fetchArxivBySearch({
        mode: arxivMode,
        value,
        from: arxivFrom || undefined,
        to:   arxivTo || undefined,
        max:  arxivMax,
      });
      if (results.length === 0) {
        setError('No papers matched that query. Check the category/spelling or widen the date range.');
        setBusy(false);
        return;
      }
      const { added, duplicates, addedPapers } = await addImportedPapers(results.map(metadataToPaper));
      setResult({ added, duplicates, failed: 0, papers: addedPapers });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'arXiv search failed');
    } finally {
      setBusy(false);
    }
  }

  function makeLocalPaper(file: File): Paper {
    const uuid = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const now = new Date();
    const title = file.name.replace(/\.pdf$/i, '').replace(/[._]+/g, ' ').trim() || 'Untitled PDF';
    return {
      id: `local-${uuid}`,
      arxivId: `local:${uuid}`,
      date: now.toDateString(),
      size: '',
      title,
      authors: '',
      authorList: [],
      categories: [],
      comments: '',
      abstract: '',
      url: '',
      pdfUrl: '',
      emailId: 'upload',
      digestSubject: 'Uploaded PDF',
      digestDate: now,
      source: 'upload',
    };
  }

  async function handleUpload() {
    if (storageMode !== 'server') {
      setError('Uploading PDFs needs server storage. Open Settings → Storage and switch to "Server (Postgres)", then try again.');
      return;
    }
    if (uploadFiles.length === 0) {
      setError('Choose one or more PDF files to upload.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    setProgress({ done: 0, total: uploadFiles.length, failures: [], label: 'PDFs' });

    // Create the paper rows first (server-side), then attach each file.
    const pairs = uploadFiles.map(file => ({ file, paper: makeLocalPaper(file) }));
    const failures: Array<{ id: string; reason: string }> = [];
    let recordResult: { added: number; duplicates: number; addedPapers: Paper[] };
    try {
      recordResult = await addImportedPapers(pairs.map(p => p.paper));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the paper records.');
      setBusy(false);
      return;
    }
    for (let i = 0; i < pairs.length; i++) {
      try {
        await uploadPaperFile(pairs[i].paper.id, pairs[i].file);
      } catch (e) {
        failures.push({ id: pairs[i].file.name, reason: e instanceof Error ? e.message : 'upload failed' });
      }
      setProgress({ done: i + 1, total: pairs.length, failures: [...failures], label: 'PDFs' });
    }
    setResult({
      added: recordResult.added,
      duplicates: recordResult.duplicates,
      failed: failures.length,
      papers: recordResult.addedPapers,
    });
    setUploadFiles([]);
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
    { id: 'arxiv',  label: 'From arXiv',     icon: <Search size={13} /> },
    { id: 'history', label: 'History',        icon: <History size={13} /> },
    { id: 'upload', label: 'Upload PDF',     icon: <Upload size={13} /> },
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
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1 mb-5 w-fit max-w-full overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); reset(); }}
              className={`flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
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

        {tab === 'arxiv' && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Search arXiv by</label>
              <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
                {(['category', 'author', 'keyword'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => { setArxivMode(m); setError(null); }}
                    className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-all ${
                      arxivMode === m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <input
                type="text"
                autoFocus
                value={arxivValue}
                onChange={e => setArxivValue(e.target.value)}
                list={arxivMode === 'category' ? 'arxiv-cats' : undefined}
                placeholder={
                  arxivMode === 'category' ? 'e.g. cs.LG, cs.CR, math.AP, hep-th'
                  : arxivMode === 'author' ? 'e.g. Yoshua Bengio'
                  : 'e.g. diffusion models, retrieval augmented generation'
                }
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all"
                onKeyDown={e => { if (e.key === 'Enter' && !busy) handleArxiv(); }}
              />
              {arxivMode === 'category' && (
                <datalist id="arxiv-cats">
                  {COMMON_CATEGORIES.map(c => <option key={c} value={c} />)}
                </datalist>
              )}
              <p className="mt-1.5 text-xs text-slate-500">
                {arxivMode === 'category' ? 'Browse all categories at arxiv.org/category_taxonomy.'
                  : arxivMode === 'author' ? 'Matches the author field; quote-exact, so use the full name.'
                  : 'Searches title, abstract, and full text.'}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">From (optional)</label>
                <input type="date" value={arxivFrom} onChange={e => setArxivFrom(e.target.value)}
                  className="w-full px-2 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">To (optional)</label>
                <input type="date" value={arxivTo} onChange={e => setArxivTo(e.target.value)}
                  className="w-full px-2 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Max papers</label>
                <input type="number" min={1} max={1000} value={arxivMax}
                  onChange={e => setArxivMax(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
                  className="w-full px-2 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
              </div>
            </div>
            <p className="text-xs text-slate-400">
              Pulls matching papers straight from the arXiv API (newest first) and adds them to your inbox.
              Large pulls take longer — arXiv is rate-limited, so 1000 papers can take ~30s.
            </p>
            {busy && (
              <p className="text-xs text-blue-600 flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" /> Searching arXiv…
              </p>
            )}
          </div>
        )}

        {tab === 'history' && (
          <div className="space-y-5">
            <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
                  <History size={15} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Build a historical arXiv library</h3>
                  <p className="mt-1 text-xs text-slate-500 leading-relaxed">
                    Runs on the server in monthly checkpoints. You can close this window; progress is saved and can be resumed.
                    Metadata and abstracts are imported, while PDFs stay on-demand.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">arXiv categories</label>
                  <input
                    value={historyCategories}
                    onChange={e => setHistoryCategories(e.target.value)}
                    list="history-arxiv-categories"
                    placeholder="e.g. cs.AI, cs.LG, cs.CL"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                  />
                  <datalist id="history-arxiv-categories">
                    {COMMON_CATEGORIES.map(c => <option key={c} value={c} />)}
                  </datalist>
                  <p className="mt-1 text-[11px] text-slate-400">Comma-separated. Each category is deduplicated against your existing papers and other selected categories.</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">From year</label>
                    <input
                      type="number" min={2000} max={new Date().getFullYear()}
                      value={historyFromYear}
                      onChange={e => setHistoryFromYear(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Through year</label>
                    <input
                      type="number" min={2000} max={new Date().getFullYear()}
                      value={historyToYear}
                      onChange={e => setHistoryToYear(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                    />
                  </div>
                </div>

                {storageMode !== 'server' ? (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Switch to Server storage in Settings to import into your account library.
                  </p>
                ) : (
                  <button
                    onClick={() => void startHistoryImport()}
                    disabled={historyBusy}
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
                  >
                    {historyBusy ? <Loader2 size={14} className="animate-spin" /> : <History size={14} />}
                    Start background import
                  </button>
                )}
              </div>
            </section>

            {historyError && (
              <div className="px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-start gap-2">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span>{historyError}</span>
              </div>
            )}

            <section>
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-800">Import jobs</h3>
                <span className="text-[11px] text-slate-400">Refreshes automatically</span>
              </div>
              {historyJobs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 px-4 py-7 text-center">
                  <p className="text-xs text-slate-500">No historical imports yet.</p>
                  <p className="text-[11px] text-slate-400 mt-1">Your job will keep running even after you close this dialog.</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {historyJobs.map(job => {
                    const percent = job.status === 'completed' ? 100
                      : job.totalSlices > 0 ? Math.floor(100 * job.sliceIndex / job.totalSlices) : 0;
                    const statusClass = job.status === 'completed' ? 'text-emerald-700 bg-emerald-50'
                      : job.status === 'failed' ? 'text-red-700 bg-red-50'
                      : job.status === 'paused' ? 'text-amber-700 bg-amber-50'
                      : job.status === 'cancelled' ? 'text-slate-500 bg-slate-100'
                      : 'text-blue-700 bg-blue-50';
                    return (
                      <article key={job.id} className="rounded-xl border border-slate-200 bg-white px-3.5 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-slate-800 truncate">{job.config.categories.join(', ')}</span>
                              <span className="text-[10px] text-slate-400 shrink-0">{job.config.fromYear}–{job.config.toYear}</span>
                            </div>
                            <p className="mt-1 text-[11px] text-slate-500">
                              {job.status === 'completed' ? 'Complete'
                                : job.status === 'failed' ? 'Stopped with an error'
                                : job.status === 'cancelled' ? 'Cancelled'
                                : job.currentSlice || (job.status === 'paused' ? 'Paused' : 'Waiting for worker')}
                            </p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold capitalize ${statusClass}`}>
                            {job.status}
                          </span>
                        </div>
                        <div className="mt-2.5 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full transition-all ${job.status === 'failed' ? 'bg-red-500' : 'bg-slate-800'}`} style={{ width: `${percent}%` }} />
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <p className="text-[10px] text-slate-400 tabular-nums">
                            {job.sliceIndex.toLocaleString()} / {job.totalSlices.toLocaleString()} month windows
                            {' · '}{job.papersAdded.toLocaleString()} added
                            {' · '}{job.papersSkipped.toLocaleString()} already present
                            {job.pageStart > 0 && ` · page offset ${job.pageStart.toLocaleString()}`}
                          </p>
                          <div className="flex items-center gap-1 shrink-0">
                            {(job.status === 'running' || job.status === 'queued') && (
                              <button onClick={() => void controlHistoryJob(job.id, 'pause')} title="Pause import" className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100">
                                <Pause size={13} />
                              </button>
                            )}
                            {(job.status === 'paused' || job.status === 'failed') && (
                              <button onClick={() => void controlHistoryJob(job.id, 'resume')} title="Resume import" className="p-1.5 rounded-md text-slate-400 hover:text-emerald-700 hover:bg-emerald-50">
                                <Play size={13} />
                              </button>
                            )}
                            {['queued', 'running', 'paused', 'failed'].includes(job.status) && (
                              <button onClick={() => void controlHistoryJob(job.id, 'cancel')} title="Cancel import" className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50">
                                <XCircle size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                        {job.error && <p className="mt-2 text-[11px] text-red-600 break-words">{job.error}</p>}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {tab === 'upload' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Upload PDFs from your computer
            </label>
            {storageMode !== 'server' ? (
              <div className="px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800 flex items-start gap-2">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span>Uploading PDFs needs server storage. Open <strong>Settings → Storage</strong> and switch to “Server (Postgres)”, then come back.</span>
              </div>
            ) : (
              <>
                <div
                  onClick={() => pdfInput.current?.click()}
                  onDragOver={e => { e.preventDefault(); }}
                  onDrop={e => {
                    e.preventDefault();
                    const dropped = Array.from(e.dataTransfer.files).filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
                    if (dropped.length) setUploadFiles(prev => [...prev, ...dropped]);
                  }}
                  className="cursor-pointer border-2 border-dashed border-slate-200 rounded-xl px-6 py-8 text-center hover:border-blue-300 hover:bg-blue-50/40 transition-colors"
                >
                  <Upload size={22} className="mx-auto text-slate-400 mb-2" />
                  <p className="text-sm text-slate-600 font-medium">Drop PDF files here, or click to browse</p>
                  <p className="text-xs text-slate-400 mt-1">PDF only · up to 50 MB each · read them in-app after upload</p>
                </div>
                <input
                  ref={pdfInput}
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  onChange={e => {
                    const chosen = Array.from(e.target.files ?? []);
                    if (chosen.length) setUploadFiles(prev => [...prev, ...chosen]);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
                {uploadFiles.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {uploadFiles.map((f, i) => (
                      <li key={`${f.name}-${i}`} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm">
                        <FileIcon size={14} className="text-blue-500 shrink-0" />
                        <span className="flex-1 truncate text-slate-700">{f.name}</span>
                        <span className="text-xs text-slate-400">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                        {!busy && (
                          <button
                            onClick={() => setUploadFiles(prev => prev.filter((_, j) => j !== i))}
                            className="text-slate-400 hover:text-red-500"
                            title="Remove"
                          >
                            <X size={13} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-xs text-slate-400">
                  Each PDF becomes a paper in your library (titled from the filename) that you can open and read in-app.
                </p>
              </>
            )}
          </div>
        )}

        {/* Progress */}
        {progress && (
          <div className="mt-5 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800">
            <div className="flex items-center gap-2 mb-1">
              <Loader2 size={14} className={busy ? 'animate-spin' : ''} />
              <span>
                {progress.label === 'PDFs' ? 'Uploaded' : 'Fetched'} {progress.done} / {progress.total}
                {progress.label === 'PDFs' ? ' PDFs' : ' from arXiv'}
              </span>
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
                {result.failed > 0     && <> · {result.failed} {progress?.label === 'PDFs' ? `file${result.failed !== 1 ? 's' : ''} failed` : 'failed'}</>}
              </p>
              {progress?.failures && progress.failures.length > 0 && (
                <ul className="text-xs mt-1 text-emerald-700/80">
                  {progress.failures.slice(0, 5).map(f => (
                    <li key={f.id} className="font-mono">{f.id} — {f.reason}</li>
                  ))}
                  {progress.failures.length > 5 && <li>… and {progress.failures.length - 5} more</li>}
                </ul>
              )}
              {result.papers.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {result.papers.slice(0, 5).map(p => (
                    <button
                      key={p.id}
                      onClick={() => { setSelectedPaper(p); onClose(); }}
                      className="flex w-full items-center gap-2 text-left text-xs text-emerald-800 hover:text-emerald-950 hover:bg-emerald-100/70 rounded px-1.5 py-1 transition-colors"
                      title="Open this paper"
                    >
                      <span className="flex-1 truncate">{p.title}</span>
                      <span className="font-medium shrink-0">Open →</span>
                    </button>
                  ))}
                  {result.papers.length > 5 && (
                    <p className="text-xs text-emerald-700/80 px-1.5">… and {result.papers.length - 5} more</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="mt-6 flex gap-3 items-center">
          <div className="flex-1" />
          <button onClick={onClose} className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
            {tab === 'history' ? 'Close' : result ? 'Done' : 'Cancel'}
          </button>
          {tab !== 'history' && (
            <button
              onClick={tab === 'single' ? handleSingle : tab === 'bulk' ? handleBulk : tab === 'bibtex' ? handleBibtex : tab === 'arxiv' ? handleArxiv : handleUpload}
              disabled={busy}
              className="px-5 py-2.5 bg-blue-600 rounded-lg text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {busy ? 'Importing…' : 'Import'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
