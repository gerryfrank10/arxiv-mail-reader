import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
  ArrowLeft, Building2, ChevronRight, Loader2, Radar, Search,
} from 'lucide-react';
import { usePapers } from '../contexts/PapersContext';
import {
  apiGetCompanies, apiGetCompanyPapers, apiScanCompanies,
  type Company, type CompanyCoverage,
} from '../utils/researchApi';
import type { Paper } from '../types';

const PAGE = 24;

const TILE_GRADIENTS = [
  'from-emerald-500 to-teal-600',
  'from-sky-500 to-indigo-600',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600',
  'from-violet-500 to-purple-600',
  'from-cyan-500 to-blue-600',
  'from-lime-500 to-green-600',
  'from-fuchsia-500 to-purple-600',
];

function companyGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return TILE_GRADIENTS[Math.abs(hash) % TILE_GRADIENTS.length];
}

function companyInitials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
}

function matches(company: Company, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || company.name.toLowerCase().includes(q);
}

function CompanyCard({ company, onOpen }: { company: Company; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-3 rounded-xl border border-[#e7e5df] bg-white p-4 text-left transition hover:border-emerald-300 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-300/50"
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${companyGradient(company.name)} text-[12px] font-bold text-white shadow-sm`}>
        {companyInitials(company.name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-slate-800 transition-colors group-hover:text-emerald-900">
          {company.name}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {company.papers.toLocaleString()} paper{company.papers === 1 ? '' : 's'} in your library
        </p>
      </div>
      <ChevronRight size={15} className="shrink-0 text-slate-300 transition group-hover:text-emerald-500" />
    </button>
  );
}

function CardSkeleton() {
  return (
    <div className="flex animate-pulse items-center gap-3 rounded-xl border border-[#e7e5df] bg-white p-4">
      <span className="h-10 w-10 shrink-0 rounded-lg bg-slate-100" />
      <div className="flex-1 space-y-2">
        <span className="block h-3 w-2/3 rounded bg-slate-100" />
        <span className="block h-2.5 w-1/2 rounded bg-slate-100" />
      </div>
    </div>
  );
}

export default function CompaniesView() {
  const { papers, storageMode, setSelectedPaper } = usePapers();

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const [companies, setCompanies] = useState<Company[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [coverage, setCoverage] = useState<CompanyCoverage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [scanning, setScanning] = useState(false);
  const [scanNotice, setScanNotice] = useState('');
  const pollTimer = useRef<number | null>(null);

  const [selected, setSelected] = useState<Company | null>(null);
  const [companyPapers, setCompanyPapers] = useState<Paper[]>([]);
  const [companyTotal, setCompanyTotal] = useState(0);
  const [papersLoading, setPapersLoading] = useState(false);
  const [papersError, setPapersError] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => () => {
    if (pollTimer.current !== null) window.clearInterval(pollTimer.current);
  }, []);

  // Local mode: aggregate the organisations already attached to the in-memory
  // library. Server mode asks the API, which groups the whole library.
  const localCompanies = useMemo<Company[]>(() => {
    const byName = new Map<string, Company>();
    for (const paper of papers) {
      const name = paper.organization?.trim();
      if (!name) continue;
      const entry = byName.get(name);
      if (entry) entry.papers += 1;
      else byName.set(name, { name, papers: 1 });
    }
    return [...byName.values()].sort((a, b) => b.papers - a.papers || a.name.localeCompare(b.name));
  }, [papers]);

  const localFiltered = useMemo(
    () => localCompanies.filter(c => matches(c, debouncedQuery)),
    [localCompanies, debouncedQuery],
  );

  const loadDirectory = useCallback(async (offset: number, append: boolean) => {
    setLoading(true);
    setError('');
    try {
      const result = await apiGetCompanies({ query: debouncedQuery, limit: PAGE, offset });
      setCompanies(prev => append ? [...prev, ...result.companies] : result.companies);
      setHasMore(result.hasMore);
      setCoverage(result.coverage);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load companies.');
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery]);

  useEffect(() => {
    if (storageMode !== 'server') {
      setError('');
      setLoading(false);
      setCompanies(localFiltered.slice(0, PAGE));
      setHasMore(localFiltered.length > PAGE);
      return;
    }
    setCompanies([]);
    setHasMore(false);
    loadDirectory(0, false);
  }, [storageMode, debouncedQuery, localFiltered, loadDirectory]);

  // Scanning reads affiliations from recent papers' PDFs. Results for queued
  // downloads arrive asynchronously, so poll the directory for a short while.
  const handleScan = async () => {
    if (scanning) return;
    setScanning(true);
    setScanNotice('');
    try {
      const result = await apiScanCompanies(25);
      await loadDirectory(0, false);
      if (result.queued > 0) {
        setScanNotice(`Reading ${result.queued} paper${result.queued === 1 ? '' : 's'} in the background…`);
        let polls = 0;
        if (pollTimer.current !== null) window.clearInterval(pollTimer.current);
        pollTimer.current = window.setInterval(async () => {
          polls += 1;
          await loadDirectory(0, false);
          if (polls >= 8 && pollTimer.current !== null) {
            window.clearInterval(pollTimer.current);
            pollTimer.current = null;
            setScanNotice('');
          }
        }, 6000);
      } else {
        setScanNotice(result.scanned > 0
          ? `Checked ${result.scanned} paper${result.scanned === 1 ? '' : 's'}.`
          : 'No new papers to check right now.');
      }
    } catch (e) {
      setScanNotice(e instanceof Error ? e.message : 'Scan failed.');
    } finally {
      setScanning(false);
    }
  };

  // Company detail — newest papers first.
  useEffect(() => {
    if (!selected || storageMode === 'server') return;
    const list = papers
      .filter(p => p.organization?.trim() === selected.name)
      .sort((a, b) => b.digestDate.getTime() - a.digestDate.getTime());
    setCompanyPapers(list.slice(0, PAGE));
    setCompanyTotal(list.length);
    setPapersLoading(false);
    setPapersError('');
  }, [selected, storageMode, papers]);

  useEffect(() => {
    if (!selected || storageMode !== 'server') return;
    let cancelled = false;
    setPapersLoading(true);
    setPapersError('');
    apiGetCompanyPapers(selected.name, { limit: PAGE, offset: 0 })
      .then(result => {
        if (cancelled) return;
        setCompanyPapers(result.papers);
        setCompanyTotal(result.total);
      })
      .catch(e => { if (!cancelled) setPapersError(e instanceof Error ? e.message : 'Could not load this company.'); })
      .finally(() => { if (!cancelled) setPapersLoading(false); });
    return () => { cancelled = true; };
  }, [selected, storageMode]);

  const loadMorePapers = async () => {
    if (!selected) return;
    if (storageMode !== 'server') {
      const list = papers
        .filter(p => p.organization?.trim() === selected.name)
        .sort((a, b) => b.digestDate.getTime() - a.digestDate.getTime());
      setCompanyPapers(list.slice(0, companyPapers.length + PAGE));
      return;
    }
    setPapersLoading(true);
    try {
      const result = await apiGetCompanyPapers(selected.name, { limit: PAGE, offset: companyPapers.length });
      setCompanyPapers(prev => [...prev, ...result.papers]);
      setCompanyTotal(result.total);
    } catch (e) {
      setPapersError(e instanceof Error ? e.message : 'Could not load more papers.');
    } finally {
      setPapersLoading(false);
    }
  };

  const loadMoreCompanies = () => {
    if (storageMode === 'server') {
      loadDirectory(companies.length, true);
    } else {
      const next = companies.length + PAGE;
      setCompanies(localFiltered.slice(0, next));
      setHasMore(next < localFiltered.length);
    }
  };

  if (selected) {
    return (
      <div className="h-full overflow-y-auto main-scroll bg-[#f6f6f3]">
        <div className="mx-auto max-w-[980px] px-5 pb-10 pt-8 sm:px-8">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="mb-5 inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 transition-colors hover:text-slate-800"
          >
            <ArrowLeft size={13} /> Back to companies
          </button>

          <div className="flex flex-wrap items-center gap-4">
            <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${companyGradient(selected.name)} text-lg font-bold text-white shadow-md`}>
              {companyInitials(selected.name)}
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="font-serif text-[30px] leading-none tracking-tight text-slate-900">{selected.name}</h1>
              <p className="mt-2 text-[12px] text-slate-500">
                {companyTotal.toLocaleString()} paper{companyTotal === 1 ? '' : 's'} in your library
              </p>
            </div>
          </div>

          {papersError && <p role="alert" className="mt-4 text-[12px] text-rose-600">{papersError}</p>}

          <div className="mt-6 overflow-hidden rounded-xl border border-[#e7e5df] bg-white">
            {papersLoading && companyPapers.length === 0 ? (
              <div className="divide-y divide-[#f0eee8]">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="animate-pulse px-5 py-4">
                    <div className="h-3 w-3/4 rounded bg-slate-100" />
                    <div className="mt-2 h-2.5 w-1/2 rounded bg-slate-100" />
                  </div>
                ))}
              </div>
            ) : companyPapers.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <Building2 size={22} className="mx-auto mb-3 text-slate-300" />
                <p className="text-[12px] text-slate-500">No papers from this company in your library yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-[#f0eee8]">
                {companyPapers.map(paper => (
                  <button
                    key={paper.id}
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
                  </button>
                ))}
              </div>
            )}
          </div>

          {companyPapers.length < companyTotal && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={loadMorePapers}
                disabled={papersLoading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#e7e5df] bg-white px-4 py-2 text-[11px] font-medium text-slate-600 transition hover:text-slate-900 disabled:opacity-50"
              >
                {papersLoading && <Loader2 size={12} className="animate-spin" />}
                Load more papers
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const coveragePct = coverage && coverage.total > 0
    ? Math.round((coverage.checked / coverage.total) * 100)
    : 0;

  return (
    <div className="h-full overflow-y-auto main-scroll bg-[#f6f6f3]">
      <div className="mx-auto max-w-[980px] px-5 pb-10 pt-8 sm:px-8">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Your research desk</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-serif text-[32px] leading-none tracking-tight text-slate-900">Companies</h1>
            <p className="mt-3 max-w-xl text-[13px] text-slate-500">
              The labs and companies behind your papers — NVIDIA, DeepSeek, ByteDance, Moonshot and more.
              Affiliations are read from each paper's first page.
            </p>
          </div>
          {storageMode === 'server' && coverage && (
            <div className="w-full sm:w-64">
              <div className="flex items-center justify-between text-[10px] text-slate-500">
                <span>{coverage.checked.toLocaleString()} of {coverage.total.toLocaleString()} papers checked</span>
                <span>{coveragePct}%</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200/70">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${Math.max(coveragePct, coverage.checked > 0 ? 1 : 0)}%` }}
                />
              </div>
              <button
                type="button"
                onClick={handleScan}
                disabled={scanning}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[#e7e5df] bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-50"
              >
                {scanning ? <Loader2 size={12} className="animate-spin" /> : <Radar size={12} />}
                Scan recent papers
              </button>
              {scanNotice && <p className="mt-1.5 text-[10px] text-slate-500">{scanNotice}</p>}
            </div>
          )}
        </div>

        <div className="relative mt-6 w-full sm:w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search companies…"
            aria-label="Search companies"
            className="w-full rounded-lg border border-[#e7e5df] bg-white py-2 pl-9 pr-3 text-[12px] text-slate-700 placeholder:text-slate-400 focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-300/40"
          />
        </div>

        <div className="mt-5">
          {error ? <p role="alert" className="text-[12px] text-rose-600">{error}</p>
          : loading && companies.length === 0 ? (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {[...Array(6)].map((_, i) => <CardSkeleton key={i} />)}
            </div>
          ) : companies.length === 0 ? (
            <div className="rounded-xl border border-[#e7e5df] bg-white px-6 py-14 text-center">
              <Building2 size={24} className="mx-auto mb-3 text-slate-300" />
              <h2 className="font-serif text-lg text-slate-700">
                {query ? 'No matching companies' : 'No companies detected yet'}
              </h2>
              <p className="mx-auto mt-1.5 max-w-sm text-[12px] leading-relaxed text-slate-500">
                {query
                  ? 'Try a different name.'
                  : storageMode === 'server'
                    ? 'Use “Scan recent papers” to read affiliations from your newest papers. Companies appear here as they are found.'
                    : 'Company affiliations are detected when papers are opened in server mode.'}
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {companies.map(company => (
                  <CompanyCard
                    key={company.name}
                    company={company}
                    onOpen={() => setSelected(company)}
                  />
                ))}
              </div>
              {hasMore && (
                <div className="mt-4 text-center">
                  <button
                    type="button"
                    onClick={loadMoreCompanies}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#e7e5df] bg-white px-4 py-2 text-[11px] font-medium text-slate-600 transition hover:text-slate-900 disabled:opacity-50"
                  >
                    {loading && <Loader2 size={12} className="animate-spin" />}
                    Load more companies
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}