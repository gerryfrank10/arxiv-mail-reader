import { useState, useMemo } from 'react';
import { Library, Plus, Trash2, Search, BookOpen, Edit2, X, AlertCircle, Loader2 } from 'lucide-react';
import { useBooks } from '../contexts/BooksContext';
import { Book } from '../types';
import { lookupBookByIsbn } from '../utils/researchApi';
import { formatDistanceToNow } from 'date-fns';
import CrossRefsPanel from './CrossRefsPanel';

export default function BooksView() {
  const { books, loading, dbEnabled, refresh } = useBooks();
  const [query, setQuery]   = useState('');
  const [selected, setSel]  = useState<Book | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!query.trim()) return books;
    const q = query.toLowerCase();
    return books.filter(b =>
      b.title.toLowerCase().includes(q) ||
      b.authors.some(a => a.toLowerCase().includes(q)) ||
      (b.isbn ?? '').includes(q) ||
      (b.tags ?? []).some(t => t.toLowerCase().includes(q))
    );
  }, [books, query]);

  if (!dbEnabled) {
    return (
      <div className="h-full flex items-center justify-center px-8 bg-slate-50">
        <div className="max-w-md text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 mx-auto flex items-center justify-center mb-4">
            <AlertCircle size={28} className="text-amber-600" />
          </div>
          <h1 className="text-xl font-semibold text-slate-800 mb-2">Books require server storage</h1>
          <p className="text-sm text-slate-500 leading-relaxed">
            Run <code className="px-1.5 py-0.5 bg-slate-200 rounded font-mono text-xs">npm run db:up</code> to start the local Postgres,
            then set <code className="px-1.5 py-0.5 bg-slate-200 rounded font-mono text-xs">DATABASE_URL</code> in <code className="px-1 py-0.5 bg-slate-200 rounded font-mono text-xs">server/.env</code>
            and restart the server. Refresh once it's running.
          </p>
          <button onClick={refresh} className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
            I've enabled it — refresh
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto main-scroll bg-slate-50">
      <div className="max-w-5xl mx-auto px-8 py-8 fade-in">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center text-white shadow-sm">
              <Library size={20} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Books</h1>
              <p className="text-sm text-slate-500">{books.length} book{books.length !== 1 ? 's' : ''} in your library</p>
            </div>
          </div>
          <button onClick={() => setAddOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 shadow-sm">
            <Plus size={15} /> Add book
          </button>
        </div>

        {/* Search */}
        {books.length > 0 && (
          <div className="relative mb-5">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by title, author, ISBN, tag…"
              className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
            />
          </div>
        )}

        {/* Loading / empty */}
        {loading && books.length === 0 && <p className="text-center text-slate-400 text-sm py-12">Loading…</p>}
        {!loading && books.length === 0 && (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-slate-200 mx-auto flex items-center justify-center mb-4">
              <BookOpen size={28} className="text-slate-400" />
            </div>
            <h2 className="text-lg font-semibold text-slate-700 mb-1">Your bookshelf is empty</h2>
            <p className="text-slate-500 text-sm max-w-md mx-auto">Add books by ISBN or manually. They'll be available as references when you're writing.</p>
            <button onClick={() => setAddOpen(true)} className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 shadow-sm">
              <Plus size={15} /> Add your first book
            </button>
          </div>
        )}

        {/* Book grid */}
        {filtered.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(book => (
              <BookCard key={book.id} book={book} onClick={() => setSel(book)} />
            ))}
          </div>
        )}

        {filtered.length === 0 && books.length > 0 && (
          <p className="text-center text-slate-400 text-sm py-12">No books match your search.</p>
        )}
      </div>

      {addOpen && <BookForm onClose={() => setAddOpen(false)} />}
      {selected && <BookForm book={selected} onClose={() => setSel(null)} />}
    </div>
  );
}

function BookCard({ book, onClick }: { book: Book; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-sm transition-all group flex gap-3"
    >
      {book.coverUrl ? (
        <img src={book.coverUrl} alt="" className="w-14 h-20 object-cover rounded-md shrink-0 shadow-sm" loading="lazy" />
      ) : (
        <div className="w-14 h-20 rounded-md bg-gradient-to-br from-cyan-100 to-blue-100 shrink-0 flex items-center justify-center">
          <BookOpen size={20} className="text-cyan-500/70" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-sm text-slate-800 group-hover:text-blue-700 transition-colors line-clamp-2 leading-snug">
          {book.title}
        </h3>
        <p className="text-xs text-slate-500 mt-1 truncate">
          {book.authors.join(', ') || '—'}{book.year ? ` · ${book.year}` : ''}
        </p>
        {book.publisher && <p className="text-[11px] text-slate-400 truncate mt-0.5">{book.publisher}</p>}
        {book.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {book.tags.slice(0, 3).map(t => (
              <span key={t} className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-cyan-50 text-cyan-700 border border-cyan-100">{t}</span>
            ))}
          </div>
        )}
        <p className="text-[10px] text-slate-400 mt-2">
          {formatDistanceToNow(new Date(book.updatedAt), { addSuffix: true })}
        </p>
      </div>
    </button>
  );
}

// =========================================================================
// Book form (add + edit)
// =========================================================================

function BookForm({ book, onClose }: { book?: Book; onClose: () => void }) {
  const { createBook, updateBook, removeBook } = useBooks();
  const editing = !!book;

  const [title,     setTitle]     = useState(book?.title     ?? '');
  const [authors,   setAuthors]   = useState((book?.authors ?? []).join(', '));
  const [isbn,      setIsbn]      = useState(book?.isbn      ?? '');
  const [year,      setYear]      = useState(book?.year      ?? '');
  const [publisher, setPublisher] = useState(book?.publisher ?? '');
  const [coverUrl,  setCoverUrl]  = useState(book?.coverUrl  ?? '');
  const [abstract,  setAbstract]  = useState(book?.abstract  ?? '');
  const [notes,     setNotes]     = useState(book?.notes     ?? '');
  const [tags,      setTags]      = useState((book?.tags ?? []).join(', '));
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleLookup() {
    if (!isbn.trim()) return;
    setLookingUp(true);
    setLookupErr(null);
    try {
      const r = await lookupBookByIsbn(isbn.trim());
      setTitle(r.title);
      setAuthors(r.authors.join(', '));
      setYear(r.year ?? '');
      setPublisher(r.publisher);
      if (r.coverUrl) setCoverUrl(r.coverUrl);
      if (r.abstract) setAbstract(r.abstract);
    } catch (e) {
      setLookupErr(e instanceof Error ? e.message : 'Lookup failed');
    } finally {
      setLookingUp(false);
    }
  }

  async function handleSave() {
    if (!title.trim()) return;
    const parsedYear: number | null = (() => {
      if (typeof year === 'number') return Number.isFinite(year) ? year : null;
      if (typeof year === 'string' && year.trim()) {
        const n = parseInt(year, 10);
        return Number.isFinite(n) ? n : null;
      }
      return null;
    })();
    const payload = {
      title:     title.trim(),
      authors:   authors.split(',').map(s => s.trim()).filter(Boolean),
      isbn:      isbn.trim() || null,
      year:      parsedYear,
      publisher: publisher.trim() || null,
      coverUrl:  coverUrl.trim()  || null,
      abstract:  abstract.trim(),
      notes:     notes.trim(),
      tags:      tags.split(',').map(s => s.trim()).filter(Boolean),
    };
    if (editing) await updateBook(book!.id, payload);
    else         await createBook(payload);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl p-6 max-h-[92vh] overflow-y-auto fade-in">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <BookOpen size={18} className="text-cyan-500" />
            {editing ? 'Edit book' : 'Add book'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X size={18} /></button>
        </div>

        {/* ISBN lookup row */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">ISBN lookup (Open Library)</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={isbn ?? ''}
              onChange={e => setIsbn(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleLookup(); } }}
              placeholder="9780262035613"
              className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-400"
            />
            <button onClick={handleLookup} disabled={!isbn || lookingUp}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-100 disabled:opacity-40 transition-colors">
              {lookingUp ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              Lookup
            </button>
          </div>
          {lookupErr && <p className="mt-2 text-xs text-red-600">{lookupErr}</p>}
        </div>

        {/* Fields */}
        <div className="space-y-3.5">
          <Field label="Title" required>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Deep Learning"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400" />
          </Field>
          <Field label="Authors" hint="comma-separated">
            <input type="text" value={authors} onChange={e => setAuthors(e.target.value)} placeholder="Ian Goodfellow, Yoshua Bengio, Aaron Courville"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Year">
              <input type="number" value={year ?? ''} onChange={e => setYear(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400" />
            </Field>
            <Field label="Publisher">
              <input type="text" value={publisher ?? ''} onChange={e => setPublisher(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400" />
            </Field>
          </div>
          <Field label="Cover URL">
            <input type="text" value={coverUrl ?? ''} onChange={e => setCoverUrl(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400" />
          </Field>
          <Field label="Abstract / description">
            <textarea value={abstract} onChange={e => setAbstract(e.target.value)} rows={3}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 resize-y" />
          </Field>
          <Field label="My notes">
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={5}
              placeholder="Key takeaways, your thoughts, page references…"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 resize-y" />
          </Field>
          <Field label="Tags" hint="comma-separated">
            <input type="text" value={tags} onChange={e => setTags(e.target.value)} placeholder="textbook, deep learning, reference"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400" />
          </Field>

          {/* Cross-refs only show on existing books (need an id) */}
          {editing && book && (
            <div className="-mx-1 px-1 border-t border-slate-100 pt-3">
              <CrossRefsPanel sourceKind="book" sourceId={book.id} />
            </div>
          )}
        </div>

        <div className="mt-7 flex items-center gap-3">
          {editing && (
            <button
              onClick={async () => {
                if (confirmDelete) { await removeBook(book!.id); onClose(); }
                else setConfirmDelete(true);
              }}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg transition-colors ${
                confirmDelete ? 'bg-red-600 text-white hover:bg-red-700' : 'text-red-600 hover:bg-red-50'
              }`}
            >
              <Trash2 size={13} />
              {confirmDelete ? 'Click again to confirm' : 'Delete'}
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button onClick={handleSave} disabled={!title.trim()}
            className="px-5 py-2.5 bg-blue-600 rounded-lg text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 flex items-center gap-2">
            <Edit2 size={14} />
            {editing ? 'Save' : 'Add to library'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
        {hint && <span className="text-xs text-slate-400 font-normal ml-1">({hint})</span>}
      </label>
      {children}
    </div>
  );
}
