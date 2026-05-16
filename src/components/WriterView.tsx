import { useState, useMemo } from 'react';
import { Pen, Plus, Quote, BookOpen, Eye, EyeOff, AlertCircle, Loader2, Download } from 'lucide-react';
import { useWriter } from '../contexts/WriterContext';
import { useLibrary } from '../contexts/LibraryContext';
import { useBooks } from '../contexts/BooksContext';
import { renderAbstract } from '../utils/latex';
import { Paper, Book, ResearchDocument } from '../types';

export default function WriterView() {
  const { active, dbEnabled, newDocument, saving, refresh } = useWriter();

  if (!dbEnabled) {
    return (
      <div className="h-full flex items-center justify-center px-8 bg-slate-50">
        <div className="max-w-md text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 mx-auto flex items-center justify-center mb-4">
            <AlertCircle size={28} className="text-amber-600" />
          </div>
          <h1 className="text-xl font-semibold text-slate-800 mb-2">Writer requires server storage</h1>
          <p className="text-sm text-slate-500 leading-relaxed">
            Drafts are stored in Postgres so they're durable and indexable.
            Start the DB and set <code className="px-1.5 py-0.5 bg-slate-200 rounded font-mono text-xs">DATABASE_URL</code>, then refresh.
          </p>
          <button onClick={refresh} className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
            I've enabled it — refresh
          </button>
        </div>
      </div>
    );
  }

  if (!active) {
    return (
      <div className="h-full flex items-center justify-center px-8 bg-slate-50">
        <div className="max-w-md text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 mx-auto flex items-center justify-center mb-5 shadow-lg shadow-violet-500/30">
            <Pen size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Writer</h1>
          <p className="text-slate-500 leading-relaxed max-w-sm mx-auto">
            Write research papers, notes, and articles. Pull citations directly from your library and bookshelf.
          </p>
          <button onClick={() => newDocument()} className="mt-6 inline-flex items-center gap-2 px-5 py-3 bg-violet-600 text-white font-medium rounded-lg hover:bg-violet-700 shadow-sm shadow-violet-500/30">
            <Plus size={16} />
            Start a new document
          </button>
          {saving && <p className="text-xs text-slate-400 mt-3 flex items-center gap-1 justify-center"><Loader2 size={11} className="animate-spin" /> creating…</p>}
        </div>
      </div>
    );
  }

  return <DocumentEditor doc={active} />;
}

// =========================================================================
// Document editor
// =========================================================================

function DocumentEditor({ doc }: { doc: ResearchDocument }) {
  const { updateActive, saving, removeDocument } = useWriter();
  const { savedPapers } = useLibrary();
  const { books } = useBooks();
  const [preview, setPreview] = useState(false);
  const [showRefs, setShowRefs] = useState(true);

  const wordCount = doc.wordCount ?? (doc.content.trim() === '' ? 0 : doc.content.trim().split(/\s+/).length);

  // Resolve currently-cited entities for the right rail
  const citedPapers = useMemo(
    () => savedPapers.filter(p => doc.paperRefs.includes(p.arxivId)),
    [savedPapers, doc.paperRefs],
  );
  const citedBooks = useMemo(
    () => books.filter(b => doc.bookRefs.includes(b.id)),
    [books, doc.bookRefs],
  );

  function togglePaperRef(p: Paper) {
    const list = new Set(doc.paperRefs);
    if (list.has(p.arxivId)) list.delete(p.arxivId); else list.add(p.arxivId);
    updateActive({ paperRefs: [...list] });
  }
  function toggleBookRef(b: Book) {
    const list = new Set(doc.bookRefs);
    if (list.has(b.id)) list.delete(b.id); else list.add(b.id);
    updateActive({ bookRefs: [...list] });
  }

  function insertCitation(label: string) {
    // Append [@label] to the end of the content for now — keeps things simple
    updateActive({ content: (doc.content || '').trimEnd() + ` [@${label}]` });
  }

  function exportMarkdown() {
    const refs = [
      ...citedPapers.map(p => `- ${p.authors} (${new Date(p.digestDate).getFullYear()}). ${p.title}. arXiv:${p.arxivId}.`),
      ...citedBooks .map(b => `- ${b.authors.join(', ')} (${b.year ?? 'n.d.'}). *${b.title}*.${b.publisher ? ` ${b.publisher}.` : ''}${b.isbn ? ` ISBN ${b.isbn}.` : ''}`),
    ].join('\n');
    const md = `# ${doc.title || 'Untitled'}\n\n${doc.content || ''}\n\n${refs ? `\n## References\n\n${refs}\n` : ''}`;
    const blob = new Blob([md], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(doc.title || 'untitled').replace(/[^\w-]+/g, '-').toLowerCase()}.md`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(a.href); }, 1000);
  }

  return (
    <div className="h-full flex bg-slate-50 overflow-hidden">
      {/* Editor */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-white border-b border-slate-200 px-8 py-3 flex items-center gap-3">
          <input
            type="text"
            value={doc.title}
            onChange={e => updateActive({ title: e.target.value })}
            placeholder="Untitled"
            className="text-xl font-bold text-slate-800 bg-transparent border-none focus:outline-none flex-1 min-w-0"
          />
          <span className="text-xs text-slate-400 shrink-0">
            {saving ? <span className="flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> saving…</span> : 'saved'}
          </span>
          <span className="text-xs text-slate-400 shrink-0">{wordCount} words</span>
          <select
            value={doc.status}
            onChange={e => updateActive({ status: e.target.value as ResearchDocument['status'] })}
            className="text-xs border border-slate-200 bg-slate-50 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
          >
            <option value="draft">Draft</option>
            <option value="in_review">In review</option>
            <option value="published">Published</option>
          </select>
          <button
            onClick={() => setPreview(p => !p)}
            title={preview ? 'Edit' : 'Preview'}
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
          >
            {preview ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button
            onClick={() => setShowRefs(v => !v)}
            title="Toggle references panel"
            className={`p-1.5 rounded-md transition-colors ${showRefs ? 'bg-violet-100 text-violet-700' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}
          >
            <Quote size={14} />
          </button>
          <button
            onClick={exportMarkdown}
            title="Export markdown"
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
          >
            <Download size={14} />
          </button>
          <button
            onClick={() => { if (confirm(`Delete "${doc.title || 'Untitled'}"?`)) removeDocument(doc.id); }}
            title="Delete"
            className="text-xs text-slate-500 hover:text-red-600 transition-colors px-2"
          >
            Delete
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto main-scroll">
          {preview ? (
            <article className="max-w-3xl mx-auto px-8 py-8 prose prose-slate prose-sm">
              <h1 className="text-2xl font-bold text-slate-900 mb-4">{doc.title || 'Untitled'}</h1>
              <div
                className="abstract-text text-slate-700 leading-relaxed whitespace-pre-wrap text-[15px]"
                dangerouslySetInnerHTML={{ __html: renderAbstract(doc.content || '') }}
              />
              {(citedPapers.length > 0 || citedBooks.length > 0) && (
                <div className="mt-10 border-t border-slate-200 pt-6">
                  <h2 className="text-sm font-bold text-slate-800 uppercase tracking-widest">References</h2>
                  <ol className="mt-3 space-y-2 text-sm text-slate-600 list-decimal pl-5">
                    {citedPapers.map(p => (
                      <li key={p.arxivId}>
                        {p.authors} ({new Date(p.digestDate).getFullYear()}). <em>{p.title}</em>. arXiv:{p.arxivId}.
                      </li>
                    ))}
                    {citedBooks.map(b => (
                      <li key={b.id}>
                        {b.authors.join(', ')} ({b.year ?? 'n.d.'}). <em>{b.title}</em>.{b.publisher ? ` ${b.publisher}.` : ''}{b.isbn ? ` ISBN ${b.isbn}.` : ''}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </article>
          ) : (
            <textarea
              value={doc.content}
              onChange={e => updateActive({ content: e.target.value })}
              placeholder="# Introduction&#10;&#10;Start writing in Markdown… Use the right panel to insert citations from your library and bookshelf."
              className="w-full h-full px-8 py-8 bg-transparent border-none focus:outline-none resize-none text-[15px] leading-relaxed text-slate-800 font-mono"
              style={{ minHeight: 'calc(100vh - 64px)' }}
            />
          )}
        </div>
      </div>

      {/* References rail */}
      {showRefs && (
        <aside className="w-80 shrink-0 bg-white border-l border-slate-200 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500">References</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {doc.paperRefs.length + doc.bookRefs.length} cited
            </p>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-4">
            {/* Cited section */}
            {(citedPapers.length > 0 || citedBooks.length > 0) && (
              <Section title="Cited">
                {citedPapers.map(p => (
                  <RefRow key={p.id} kind="paper" label={p.title} sub={`arXiv:${p.arxivId}`} cited onToggle={() => togglePaperRef(p)} onInsert={() => insertCitation(p.arxivId)} />
                ))}
                {citedBooks.map(b => (
                  <RefRow key={b.id} kind="book" label={b.title} sub={b.authors[0] ?? '—'} cited onToggle={() => toggleBookRef(b)} onInsert={() => insertCitation(b.id)} />
                ))}
              </Section>
            )}

            {/* Library (uncited) */}
            <Section title="From library" hint="click to cite">
              {savedPapers.length === 0 && <p className="text-xs text-slate-400 px-3 py-1">No saved papers. Bookmark some from Inbox.</p>}
              {savedPapers.filter(p => !doc.paperRefs.includes(p.arxivId)).slice(0, 50).map(p => (
                <RefRow key={p.id} kind="paper" label={p.title} sub={`${p.authorList[0] ?? '—'} · arXiv:${p.arxivId}`} onToggle={() => togglePaperRef(p)} />
              ))}
            </Section>

            {/* Books (uncited) */}
            <Section title="From bookshelf" hint="click to cite">
              {books.length === 0 && <p className="text-xs text-slate-400 px-3 py-1">No books. Add some in Books.</p>}
              {books.filter(b => !doc.bookRefs.includes(b.id)).slice(0, 50).map(b => (
                <RefRow key={b.id} kind="book" label={b.title} sub={`${b.authors[0] ?? '—'}${b.year ? ` · ${b.year}` : ''}`} onToggle={() => toggleBookRef(b)} />
              ))}
            </Section>
          </div>
        </aside>
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between px-2 mb-1">
        <p className="text-[10px] uppercase font-semibold tracking-wider text-slate-400">{title}</p>
        {hint && <p className="text-[10px] text-slate-300">{hint}</p>}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function RefRow({
  kind, label, sub, cited, onToggle, onInsert,
}: {
  kind: 'paper' | 'book';
  label: string;
  sub: string;
  cited?: boolean;
  onToggle: () => void;
  onInsert?: () => void;
}) {
  return (
    <div className={`group flex items-start gap-2 px-2 py-1.5 rounded-md ${cited ? 'bg-violet-50 hover:bg-violet-100' : 'hover:bg-slate-100'} transition-colors`}>
      {kind === 'paper' ? <Quote size={11} className="text-slate-400 mt-0.5 shrink-0" /> : <BookOpen size={11} className="text-slate-400 mt-0.5 shrink-0" />}
      <button onClick={onToggle} className="flex-1 min-w-0 text-left">
        <p className="text-xs font-medium text-slate-800 line-clamp-2">{label}</p>
        <p className="text-[10px] text-slate-500 truncate mt-0.5">{sub}</p>
      </button>
      {cited && onInsert && (
        <button
          onClick={onInsert}
          title="Insert [@id] marker at end of content"
          className="opacity-0 group-hover:opacity-100 text-[10px] text-violet-600 hover:text-violet-800 font-medium shrink-0 px-1"
        >
          insert
        </button>
      )}
    </div>
  );
}
