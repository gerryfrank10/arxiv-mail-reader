import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  ArrowUpRight, Building2, Check, Flame, Loader2, Plus,
} from 'lucide-react';
import { usePapers } from '../contexts/PapersContext';
import {
  apiGetCompanyPapers, apiGetHfCompanyPapers, type HfPaper,
} from '../utils/researchApi';
import type { Paper } from '../types';

const PAGE = 20;

const bareId = (id: string) => id.trim().toLowerCase().replace(/v\d+$/i, '');

function hfToPaper(hf: HfPaper): Paper {
  return {
    id: `imp-${hf.arxivId}`,
    arxivId: hf.arxivId,
    date: '',
    size: '',
    title: hf.title,
    authors: hf.authors.join(', '),
    authorList: hf.authors,
    categories: [],
    comments: '',
    abstract: hf.abstract,
    url: `https://arxiv.org/abs/${hf.arxivId}`,
    pdfUrl: `https://arxiv.org/pdf/${hf.arxivId}`,
    emailId: 'import',
    digestSubject: 'Hugging Face',
    digestDate: hf.publishedAt ? new Date(hf.publishedAt) : new Date(),
    source: 'import',
  };
}

type Row =
  | { kind: 'library'; key: string; paper: Paper; at: number }
  | { kind: 'hf'; key: string; hf: HfPaper; at: number };

// A company tab in the dashboard: the company's papers from the library merged
// with what its org has posted on Hugging Face, newest first. HF-only papers
// can be added to the library in one click.
export default function CompanyFeed({ company }: { company: string }) {
  const { papers, storageMode, setSelectedPaper, addImportedPapers } = usePapers();

  const [libraryPapers, setLibraryPapers] = useState<Paper[]>([]);
  const [libraryTotal, setLibraryTotal] = useState(0);
  const [hfPapers, setHfPapers] = useState<HfPaper[]>([]);
  const [hfError, setHfError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [added, setAdded] = useState<Map<string, Paper>>(new Map());
  const [importing, setImporting] = useState<string | null>(null);

  const localLibrary = useMemo(() => papers
    .filter(p => p.organization?.trim() === company)
    .sort((a, b) => b.digestDate.getTime() - a.digestDate.getTime()),
  [papers, company]);

  const loadLibrary = useCallback(async (offset: number, append: boolean) => {
    setLoading(true);
    setError('');
    try {
      const result = await apiGetCompanyPapers(company, { limit: PAGE, offset });
      setLibraryPapers(prev => append ? [...prev, ...result.papers] : result.papers);
      setLibraryTotal(result.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this company’s papers.');
    } finally {
      setLoading(false);
    }
  }, [company]);

  useEffect(() => {
    setAdded(new Map());
  }, [company]);

  useEffect(() => {
    if (storageMode === 'server') return;
    setHfPapers([]);
    setHfError('');
    setLibraryPapers(localLibrary.slice(0, PAGE));
    setLibraryTotal(localLibrary.length);
    setError('');
  }, [company, storageMode, localLibrary]);

  useEffect(() => {
    if (storageMode !== 'server') return;
    setAdded(new Map());
    setHfPapers([]);
    setHfError('');
    setLibraryPapers([]);
    setLibraryTotal(0);
    loadLibrary(0, false);
    let cancelled = false;
    apiGetHfCompanyPapers(company)
      .then(list => { if (!cancelled) setHfPapers(list); })
      .catch(e => { if (!cancelled) setHfError(e instanceof Error ? e.message : 'Hugging Face is unavailable.'); });
    return () => { cancelled = true; };
  }, [company, storageMode, loadLibrary]);

  // Merge library + HF, deduping by bare arXiv id; the library copy wins.
  const rows = useMemo<Row[]>(() => {
    const libraryKeys = new Set(libraryPapers.map(p => bareId(p.arxivId || p.id)));
    const merged: Row[] = libraryPapers.map(paper => ({
      kind: 'library',
      key: `lib-${paper.id}`,
      paper,
      at: paper.digestDate.getTime(),
    }));
    for (const hf of hfPapers) {
      const key = bareId(hf.arxivId);
      if (libraryKeys.has(key)) continue;
      merged.push({
        kind: 'hf',
        key: `hf-${key}`,
        hf,
        at: hf.publishedAt ? new Date(hf.publishedAt).getTime() : 0,
      });
    }
    merged.sort((a, b) => b.at - a.at);
    return merged;
  }, [libraryPapers, hfPapers]);

  const importHf = async (hf: HfPaper) => {
    setImporting(hf.arxivId);
    try {
      const result = await addImportedPapers([hfToPaper(hf)]);
      const paper = result.addedPapers[0]
        ?? papers.find(p => bareId(p.arxivId) === bareId(hf.arxivId));
      if (paper) setAdded(prev => new Map(prev).set(bareId(hf.arxivId), paper));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add this paper.');
    } finally {
      setImporting(null);
    }
  };

  const loadMore = () => {
    if (storageMode === 'server') {
      loadLibrary(libraryPapers.length, true);
    } else {
      const next = libraryPapers.length + PAGE;
      setLibraryPapers(localLibrary.slice(0, next));
    }
  };

  const hfOnlyCount = rows.filter(r => r.kind === 'hf').length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <span>
          <span className="font-semibold text-slate-700">{libraryTotal.toLocaleString()}</span> in your library
          {storageMode === 'server' && hfOnlyCount > 0 && (
            <> · <span className="font-semibold text-slate-700">{hfOnlyCount}</span> more on Hugging Face</>
          )}
        </span>
        {hfError && <span className="text-amber-600">Hugging Face unavailable — showing library only.</span>}
      </div>

      {error && <p role="alert" className="mb-3 text-[12px] text-rose-600">{error}</p>}

      <div className="overflow-hidden rounded-xl border border-[#e7e5df] bg-white">
        {loading && rows.length === 0 ? (
          <div className="divide-y divide-[#f0eee8]">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="animate-pulse px-5 py-4">
                <div className="h-3 w-3/4 rounded bg-slate-100" />
                <div className="mt-2 h-2.5 w-1/2 rounded bg-slate-100" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <Building2 size={22} className="mx-auto mb-3 text-slate-300" />
            <p className="text-[12px] text-slate-500">
              No papers from {company} found yet.
              {storageMode === 'server' && ' Their Hugging Face posts will appear here once available.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#f0eee8]">
            {rows.map(row => {
              if (row.kind === 'library') {
                const paper = row.paper;
                return (
                  <button
                    key={row.key}
                    type="button"
                    onClick={() => setSelectedPaper(paper)}
                    className="block w-full px-5 py-4 text-left transition-colors hover:bg-[#faf9f6]"
                  >
                    <p className="line-clamp-2 text-[13px] font-medium text-slate-800">{paper.title}</p>
                    <p className="mt-1 truncate text-[11px] text-slate-500">
                      {paper.authors || paper.authorList.join(', ')}
                    </p>
                    <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
                      {format(paper.digestDate, 'MMM d, yyyy')} · {paper.arxivId}
                    </p>
                    {paper.abstract && (
                      <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-relaxed text-slate-600">{paper.abstract}</p>
                    )}
                  </button>
                );
              }

              const hf = row.hf;
              const key = bareId(hf.arxivId);
              const addedPaper = added.get(key);
              const busy = importing === hf.arxivId;
              return (
                <div key={row.key} className="px-5 py-4 transition-colors hover:bg-[#faf9f6]">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700">
                          <Flame size={9} /> Hugging Face
                        </span>
                        {hf.upvotes > 0 && (
                          <span className="text-[10px] font-medium text-slate-400">▲ {hf.upvotes}</span>
                        )}
                      </div>
                      {addedPaper ? (
                        <button
                          type="button"
                          onClick={() => setSelectedPaper(addedPaper)}
                          className="text-left"
                        >
                          <p className="line-clamp-2 text-[13px] font-medium text-slate-800">{hf.title}</p>
                        </button>
                      ) : (
                        <a href={hf.url} target="_blank" rel="noreferrer" className="block">
                          <p className="line-clamp-2 text-[13px] font-medium text-slate-800 hover:text-amber-800">{hf.title}</p>
                        </a>
                      )}
                      <p className="mt-1 truncate text-[11px] text-slate-500">{hf.authors.join(', ')}</p>
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
                        {hf.publishedAt ? format(new Date(hf.publishedAt), 'MMM d, yyyy') : 'Recent'} · {hf.arxivId}
                      </p>
                      {hf.abstract && (
                        <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-relaxed text-slate-600">{hf.abstract}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {addedPaper ? (
                        <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[10px] font-medium text-emerald-700">
                          <Check size={11} /> In library
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => importHf(hf)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#e7e5df] bg-white px-2.5 py-1.5 text-[10px] font-medium text-slate-600 transition hover:border-amber-300 hover:text-amber-700 disabled:opacity-50"
                        >
                          {busy ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                          Add to library
                        </button>
                      )}
                      <a
                        href={hf.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-[10px] text-slate-400 transition-colors hover:text-slate-700"
                      >
                        View <ArrowUpRight size={10} />
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {libraryPapers.length < libraryTotal && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#e7e5df] bg-white px-4 py-2 text-[11px] font-medium text-slate-600 transition hover:text-slate-900 disabled:opacity-50"
          >
            {loading && <Loader2 size={12} className="animate-spin" />}
            Load more from library
          </button>
        </div>
      )}
    </div>
  );
}