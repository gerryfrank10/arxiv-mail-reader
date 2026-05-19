import { useEffect, useRef, useState } from 'react';
import { Search, X, Quote, BookOpen, FileText, FolderOpen, Newspaper, Loader2 } from 'lucide-react';
import { apiGlobalSearch, SearchResult, SearchResultKind } from '../utils/researchApi';
import { usePapers } from '../contexts/PapersContext';
import { useBooks } from '../contexts/BooksContext';
import { useWriter } from '../contexts/WriterContext';
import { useMagazine } from '../contexts/MagazineContext';
import { ActiveView } from './AppLayout';

interface Props {
  onClose: () => void;
  setActiveView: (v: ActiveView) => void;
}

const KIND_LABEL: Record<SearchResultKind, string> = {
  paper:      'Paper',
  book:       'Book',
  document:   'Document',
  collection: 'Collection',
  magazine:   'Magazine',
};

const KIND_ACCENT: Record<SearchResultKind, string> = {
  paper:      'bg-blue-100 text-blue-700 border-blue-200',
  book:       'bg-cyan-100 text-cyan-700 border-cyan-200',
  document:   'bg-violet-100 text-violet-700 border-violet-200',
  collection: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200',
  magazine:   'bg-rose-100 text-rose-700 border-rose-200',
};

export default function SearchOverlay({ onClose, setActiveView }: Props) {
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState<SearchResult[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [activeIdx, setActive]  = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const { papers, setSelectedPaper } = usePapers();
  const { setActiveId: setWriterDocId } = useWriter();
  const { setActiveId: setMagazineId  } = useMagazine();
  // Books/collections don't have a per-id setter; we navigate to the
  // workspace and the user picks from there.
  useBooks();

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);

  // Debounced search
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    const handle = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try { setResults(await apiGlobalSearch(query.trim())); setActive(0); }
      catch (e) { setError(e instanceof Error ? e.message : 'Search failed'); }
      finally  { setLoading(false); }
    }, 180);
    return () => clearTimeout(handle);
  }, [query]);

  function activate(r: SearchResult) {
    switch (r.kind) {
      case 'paper': {
        const p = papers.find(x => x.id === r.id || x.arxivId === r.sub);
        if (p) setSelectedPaper(p);
        else   setActiveView('inbox');
        break;
      }
      case 'book':       setActiveView('books');       break;
      case 'document':   setActiveView('writer');      setWriterDocId(r.id); break;
      case 'collection': setActiveView('collections'); break;
      case 'magazine':   setActiveView('magazine');    setMagazineId(r.id);  break;
    }
    onClose();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(results.length - 1, i + 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(i => Math.max(0, i - 1)); return; }
      if (e.key === 'Enter' && results[activeIdx]) {
        e.preventDefault();
        activate(results[activeIdx]);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, activeIdx]);

  // Group results by kind so the overlay is scannable, but keep the
  // overall order so up/down arrow flow makes sense.
  const grouped: Array<{ kind: SearchResultKind; items: SearchResult[] }> = [];
  for (const r of results) {
    let bucket = grouped[grouped.length - 1];
    if (!bucket || bucket.kind !== r.kind) {
      bucket = { kind: r.kind, items: [] };
      grouped.push(bucket);
    }
    bucket.items.push(r);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
          <Search size={16} className="text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search everything — papers, books, documents, collections, magazine…"
            className="flex-1 bg-transparent text-sm text-slate-800 placeholder-slate-400 focus:outline-none"
          />
          {loading && <Loader2 size={14} className="animate-spin text-slate-400" />}
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700">
            <X size={14} />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {error && (
            <p className="text-sm text-red-600 px-4 py-3">{error}</p>
          )}
          {!error && query.trim().length < 2 && (
            <div className="px-4 py-10 text-center text-sm text-slate-400">
              Type at least 2 characters to search.<br />
              <span className="text-xs">Use ↑ / ↓ to navigate, Enter to open, Esc to close.</span>
            </div>
          )}
          {!error && query.trim().length >= 2 && !loading && results.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-slate-400">No matches for "{query}".</p>
          )}
          {grouped.map(group => {
            let flatIdx = -1;
            return (
              <div key={group.kind} className="py-2">
                <p className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{KIND_LABEL[group.kind]}s</p>
                {group.items.map(it => {
                  // Compute the global index by counting items up to this one
                  flatIdx = results.findIndex(r => r === it);
                  const isActive = flatIdx === activeIdx;
                  return (
                    <button
                      key={`${it.kind}-${it.id}`}
                      onClick={() => activate(it)}
                      onMouseEnter={() => setActive(flatIdx)}
                      className={`w-full text-left px-4 py-2.5 flex items-start gap-3 transition-colors ${
                        isActive ? 'bg-blue-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span className={`w-7 h-7 rounded-md border flex items-center justify-center shrink-0 mt-0.5 ${KIND_ACCENT[it.kind]}`}>
                        <KindIcon kind={it.kind} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium line-clamp-1 ${isActive ? 'text-blue-700' : 'text-slate-800'}`}>{it.title}</p>
                        {it.snippet && <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{it.snippet}</p>}
                        {it.sub && <p className="text-[10px] text-slate-400 mt-0.5">{it.sub}</p>}
                      </div>
                      <span className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${KIND_ACCENT[it.kind]} shrink-0`}>
                        {KIND_LABEL[it.kind]}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="px-4 py-2 border-t border-slate-100 text-[10px] text-slate-400 flex items-center justify-between bg-slate-50">
          <span>↑↓ navigate · Enter open · Esc close</span>
          {results.length > 0 && <span>{results.length} result{results.length !== 1 ? 's' : ''}</span>}
        </div>
      </div>
    </div>
  );
}

function KindIcon({ kind }: { kind: SearchResultKind }) {
  switch (kind) {
    case 'paper':      return <Quote      size={13} />;
    case 'book':       return <BookOpen   size={13} />;
    case 'document':   return <FileText   size={13} />;
    case 'collection': return <FolderOpen size={13} />;
    case 'magazine':   return <Newspaper  size={13} />;
  }
}
