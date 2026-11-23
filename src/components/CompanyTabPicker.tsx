import { useEffect, useMemo, useState } from 'react';
import { Building2, Check, Loader2, Plus, Search, X } from 'lucide-react';
import { usePapers } from '../contexts/PapersContext';
import { apiGetCompanies, apiGetSuggestedCompanies } from '../utils/researchApi';

// Fallback suggestions for local mode (no server directory available).
const LOCAL_SUGGESTIONS = [
  'NVIDIA', 'DeepSeek', 'ByteDance', 'Moonshot AI', 'Google DeepMind', 'Meta',
  'OpenAI', 'Anthropic', 'Microsoft', 'Alibaba', 'Mistral AI', 'Hugging Face',
];

interface Props {
  pinned: string[];
  onToggle: (name: string) => void;
  onClose: () => void;
  onOpenDirectory?: () => void;
}

// The "+" picker next to the dashboard tabs: choose which companies get their
// own tab, Twitter-community style.
export default function CompanyTabPicker({ pinned, onToggle, onClose, onOpenDirectory }: Props) {
  const { papers, storageMode } = usePapers();
  const [query, setQuery] = useState('');
  const [libraryCompanies, setLibraryCompanies] = useState<Array<{ name: string; papers: number }>>([]);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (storageMode !== 'server') {
      const byName = new Map<string, number>();
      for (const paper of papers) {
        const name = paper.organization?.trim();
        if (name) byName.set(name, (byName.get(name) ?? 0) + 1);
      }
      setLibraryCompanies([...byName.entries()].map(([name, count]) => ({ name, papers: count })));
      setSuggested(LOCAL_SUGGESTIONS);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([
      apiGetCompanies({ limit: 100 }),
      apiGetSuggestedCompanies(),
    ]).then(([dir, sug]) => {
      if (cancelled) return;
      if (dir.status === 'fulfilled') setLibraryCompanies(dir.value.companies);
      if (sug.status === 'fulfilled') setSuggested(sug.value);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [storageMode, papers]);

  const options = useMemo(() => {
    const byName = new Map<string, { name: string; papers: number | null }>();
    for (const name of suggested) byName.set(name, { name, papers: null });
    for (const c of libraryCompanies) byName.set(c.name, { name: c.name, papers: c.papers });
    const q = query.trim().toLowerCase();
    return [...byName.values()]
      .filter(c => !q || c.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const ap = pinned.includes(a.name) ? 1 : 0;
        const bp = pinned.includes(b.name) ? 1 : 0;
        if (ap !== bp) return bp - ap;
        return (b.papers ?? -1) - (a.papers ?? -1) || a.name.localeCompare(b.name);
      });
  }, [suggested, libraryCompanies, query, pinned]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 px-4 pt-[12vh]" onClick={onClose}>
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-[#e7e5df] bg-white shadow-xl"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Choose company tabs"
      >
        <div className="flex items-center justify-between border-b border-[#f0eee8] px-5 py-4">
          <div>
            <h2 className="font-serif text-lg text-slate-900">Company tabs</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">Pin the labs you want to keep an eye on.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={16} />
          </button>
        </div>

        <div className="border-b border-[#f0eee8] px-5 py-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search companies…"
              className="w-full rounded-lg border border-[#e7e5df] bg-white py-2 pl-9 pr-3 text-[12px] text-slate-700 placeholder:text-slate-400 focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-300/40"
            />
          </div>
        </div>

        <div className="max-h-[46vh] overflow-y-auto main-scroll px-2 py-2">
          {loading && options.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-slate-400">
              <Loader2 size={14} className="animate-spin" /> Loading companies…
            </div>
          ) : options.length === 0 ? (
            <p className="px-3 py-10 text-center text-[12px] text-slate-500">No matching companies.</p>
          ) : options.map(option => {
            const isPinned = pinned.includes(option.name);
            return (
              <button
                key={option.name}
                type="button"
                onClick={() => onToggle(option.name)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-[#faf9f6]"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  <Building2 size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-slate-800">{option.name}</span>
                  <span className="block text-[10px] text-slate-400">
                    {option.papers != null
                      ? `${option.papers.toLocaleString()} paper${option.papers === 1 ? '' : 's'} in your library`
                      : 'Papers via Hugging Face'}
                  </span>
                </span>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium transition ${
                  isPinned
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-[#e7e5df] text-slate-500'
                }`}>
                  {isPinned ? <><Check size={10} /> Pinned</> : <><Plus size={10} /> Pin</>}
                </span>
              </button>
            );
          })}
        </div>

        {onOpenDirectory && (
          <div className="border-t border-[#f0eee8] px-5 py-3">
            <button
              type="button"
              onClick={onOpenDirectory}
              className="text-[11px] font-medium text-slate-500 transition-colors hover:text-slate-900"
            >
              Open the full company directory →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}