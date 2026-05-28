import { useState, useMemo, useRef, useEffect } from 'react';
import { Pen, Plus, Quote, BookOpen, Eye, EyeOff, AlertCircle, Loader2, Download, Sparkles, Wand2, Target, Lightbulb, Timer, Check, X } from 'lucide-react';
import { useWriter } from '../contexts/WriterContext';
import { useLibrary } from '../contexts/LibraryContext';
import { useBooks } from '../contexts/BooksContext';
import { usePapers } from '../contexts/PapersContext';
import { renderAbstract } from '../utils/latex';
import { Paper, Book, ResearchDocument } from '../types';
import { aiChat, hasAI, providerLabel, resolveAIConfig } from '../utils/aiProvider';
import { extractJson, describeJsonError } from '../utils/aiJson';
import { WRITER_TEMPLATES, docFromTopic, WriterTemplate } from '../utils/writerTemplates';
import CrossRefsPanel from './CrossRefsPanel';
import { useConfirm } from '../contexts/ConfirmContext';

export default function WriterView() {
  const { active, dbEnabled, refresh } = useWriter();

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
    return <StartScreen />;
  }

  return <DocumentEditor doc={active} />;
}

// =========================================================================
// Start screen — templates + topic ideation
// =========================================================================

function StartScreen() {
  const { newDocument, saving } = useWriter();
  const [topicOpen, setTopicOpen] = useState(false);

  async function startFrom(t: WriterTemplate) {
    await newDocument({ title: t.title, content: t.content });
  }

  return (
    <div className="h-full overflow-y-auto main-scroll bg-slate-50">
      <div className="max-w-3xl mx-auto px-8 py-12">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 mx-auto flex items-center justify-center mb-5 shadow-lg shadow-violet-500/30">
            <Pen size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Writer</h1>
          <p className="text-slate-500 leading-relaxed max-w-sm mx-auto">
            Start from a structured scaffold, or let AI propose research topics from your library.
          </p>
          <button
            onClick={() => setTopicOpen(true)}
            className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 shadow-sm shadow-violet-500/30"
          >
            <Lightbulb size={15} /> Generate topic ideas
          </button>
        </div>

        <p className="text-[11px] uppercase font-semibold tracking-wider text-slate-400 mb-2 px-1">Start from a template</p>
        <div className="grid sm:grid-cols-2 gap-3">
          {WRITER_TEMPLATES.map(t => (
            <button
              key={t.id}
              onClick={() => startFrom(t)}
              className="text-left p-4 rounded-xl border border-slate-200 bg-white hover:border-violet-300 hover:shadow-sm transition-all group"
            >
              <div className="flex items-center gap-2 mb-1">
                <Plus size={14} className="text-slate-300 group-hover:text-violet-500" />
                <span className="text-sm font-semibold text-slate-800 group-hover:text-violet-700">{t.label}</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">{t.description}</p>
            </button>
          ))}
        </div>
        {saving && <p className="text-xs text-slate-400 mt-4 flex items-center gap-1 justify-center"><Loader2 size={11} className="animate-spin" /> creating…</p>}
      </div>

      {topicOpen && <TopicGenerator onClose={() => setTopicOpen(false)} />}
    </div>
  );
}

// =========================================================================
// Document editor
// =========================================================================

function DocumentEditor({ doc }: { doc: ResearchDocument }) {
  const { updateActive, saving, removeDocument } = useWriter();
  const { savedPapers } = useLibrary();
  const { books } = useBooks();
  const { settings } = usePapers();
  const confirm = useConfirm();
  const [preview, setPreview] = useState(false);
  const [showRefs, setShowRefs] = useState(true);
  const [aiSuggesting, setAiSuggesting]   = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<Array<{ arxivId: string; reason: string }> | null>(null);
  const [aiError, setAiError]             = useState<string | null>(null);
  const aiOn   = hasAI(settings);
  const aiName = providerLabel(resolveAIConfig(settings));

  const taRef = useRef<HTMLTextAreaElement>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [composing, setComposing]       = useState<string | null>(null);
  const [composeError, setComposeError] = useState<string | null>(null);

  const wordCount = doc.wordCount ?? (doc.content.trim() === '' ? 0 : doc.content.trim().split(/\s+/).length);
  const pace = useWriterPace(wordCount);

  // Read the current textarea selection (falls back to whole document).
  function getSelection() {
    const ta = taRef.current;
    if (!ta) return { start: doc.content.length, end: doc.content.length, text: '' };
    return { start: ta.selectionStart, end: ta.selectionEnd, text: doc.content.slice(ta.selectionStart, ta.selectionEnd) };
  }

  // Splice `text` into the content, replacing [start,end). Restores the caret
  // just after the inserted text on the next tick.
  function spliceContent(start: number, end: number, text: string) {
    const next = doc.content.slice(0, start) + text + doc.content.slice(end);
    updateActive({ content: next });
    const caret = start + text.length;
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (ta) { ta.focus(); ta.setSelectionRange(caret, caret); }
    });
  }

  // Run an AI compose action. `scope` decides what context we send and where
  // the result lands. Returns prose (not JSON), so no parsing needed.
  async function compose(action: string, opts: { needsSelection?: boolean } = {}) {
    if (!aiOn || composing) return;
    const sel = getSelection();
    if (opts.needsSelection && !sel.text.trim()) {
      setComposeError('Select some text first.');
      return;
    }
    setComposing(action);
    setComposeError(null);

    const before = doc.content.slice(0, sel.start);
    const ctxBefore = before.length > 2000 ? before.slice(-2000) : before;

    const prompts: Record<string, string> = {
      continue: `You are a research-writing assistant continuing the author's draft. Write the next 1–2 paragraphs that naturally follow. Match the existing tone and Markdown style. Do not repeat what's already written, do not add a heading, output ONLY the new prose.\n\nDRAFT SO FAR (most recent part):\n"""\n${ctxBefore || '(empty)'}\n"""`,
      expand:   `Turn the following notes/bullets into flowing, precise academic prose. Keep all technical content; do not invent citations or numbers. Output ONLY the rewritten prose.\n\nNOTES:\n"""\n${sel.text}\n"""`,
      tighten:  `Tighten the following passage: remove redundancy and hedging, keep every claim and number, prefer active voice. Output ONLY the revised passage, same language.\n\nPASSAGE:\n"""\n${sel.text}\n"""`,
      academic: `Rewrite the following in a formal academic register suitable for a peer-reviewed paper. Preserve meaning, claims and any numbers; avoid hype words. Output ONLY the rewritten text.\n\nTEXT:\n"""\n${sel.text}\n"""`,
      abstract: `Write a single-paragraph abstract (150–220 words) for the paper below: state the problem, the gap, what is done, the key result, and why it matters. Output ONLY the abstract paragraph.\n\nPAPER:\n"""\n${doc.content.slice(0, 6000) || '(empty)'}\n"""`,
      related:  `Write a "Related Work" paragraph that situates the author's draft against the papers below. Cite each relevant paper inline using its marker like [@arxivId]. Group by theme and end by stating how the author's work differs. Output ONLY the prose.\n\nDRAFT CONTEXT:\n"""\n${ctxBefore.slice(-1200) || '(empty)'}\n"""\n\nPAPERS (cite with the bracketed marker):\n${citedPapers.map(p => `[@${p.arxivId}] ${p.title} — ${p.authorList.slice(0, 2).join(', ')}. ${(p.abstract || '').slice(0, 200)}`).join('\n') || '(no papers cited yet — add some from the rail first)'}`,
    };

    try {
      const text = (await aiChat(
        [{ role: 'user', content: prompts[action] }],
        settings,
        { maxTokens: 1200, temperature: 0.5, timeoutMs: 90_000, purpose: 'writer-compose' },
      )).trim();
      if (!text) throw new Error('Empty response — try again.');

      if (action === 'expand' || action === 'tighten' || action === 'academic') {
        spliceContent(sel.start, sel.end, text);          // replace selection
      } else if (action === 'abstract') {
        spliceContent(0, 0, `${text}\n\n`);               // prepend
      } else {
        const insertAt = sel.end;                          // continue / related → at caret
        const pad = doc.content.slice(Math.max(0, insertAt - 2), insertAt).endsWith('\n') ? '' : '\n\n';
        spliceContent(insertAt, insertAt, `${pad}${text}`);
      }
    } catch (e) {
      setComposeError(e instanceof Error ? e.message : 'AI compose failed');
    } finally {
      setComposing(null);
    }
  }

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
    // Insert [@label] at the caret (or replace the selection). Falls back to
    // appending at the end when the textarea isn't focused.
    const ta = taRef.current;
    const marker = `[@${label}]`;
    if (!ta || ta.selectionStart == null) {
      updateActive({ content: (doc.content || '').trimEnd() + ` ${marker}` });
      return;
    }
    const { selectionStart: s, selectionEnd: e } = ta;
    const needsLeadingSpace = s > 0 && !/\s/.test(doc.content[s - 1]);
    spliceContent(s, e, `${needsLeadingSpace ? ' ' : ''}${marker}`);
  }

  async function suggestCitations() {
    if (!aiOn) return;
    setAiSuggesting(true);
    setAiError(null);
    setAiSuggestions(null);
    // Provide the model with the document content + a compact list of library papers
    // (capped to 30 to stay inside reasonable context budgets).
    const candidates = savedPapers.slice(0, 30).map(p => ({
      arxivId:  p.arxivId,
      title:    p.title,
      authors:  p.authorList.slice(0, 3).join(', '),
      abstract: (p.abstract || '').slice(0, 240),
    }));
    if (candidates.length === 0) {
      setAiError('Your library is empty — bookmark some papers first.');
      setAiSuggesting(false);
      return;
    }
    // Trim very long documents to the last ~3500 chars so we focus on what the
    // user is currently writing.
    const recent = doc.content.length > 3500 ? doc.content.slice(-3500) : doc.content;
    const prompt = `You are a research writing assistant. The user is working on a paper. Based on the content below, identify which of their library papers are MOST relevant to cite. Return strict JSON ONLY.

USER'S CURRENT DRAFT (most recent ${Math.min(recent.length, 3500)} chars):
"""
${recent || '(empty)'}
"""

USER'S LIBRARY (only suggest from these):
${candidates.map((c, i) => `${i + 1}. [arxiv:${c.arxivId}] ${c.title}\n   Authors: ${c.authors}\n   Abstract: ${c.abstract}`).join('\n\n')}

Already cited (don't repeat): ${doc.paperRefs.join(', ') || 'none'}

Return up to 5 suggestions, ranked by relevance. Penalise generic matches; reward papers that would specifically improve a citation in the user's draft. JSON shape:
[
  {"arxivId": "...", "reason": "one short sentence (≤ 20 words) — why this fits where they're writing"},
  ...
]`;
    try {
      const text = await aiChat(
        [{ role: 'user', content: prompt }],
        settings,
        { maxTokens: 600, temperature: 0.3, timeoutMs: 45_000, purpose: 'writer-cite-suggest' },
      );
      const m = text.match(/\[[\s\S]*\]/);
      if (!m) throw new Error('Could not parse AI response');
      const parsed = JSON.parse(m[0]) as Array<{ arxivId: string; reason: string }>;
      // Filter to ones that exist in library + aren't already cited
      const known = new Set(savedPapers.map(p => p.arxivId));
      const already = new Set(doc.paperRefs);
      const cleaned = parsed
        .filter(s => known.has(s.arxivId) && !already.has(s.arxivId))
        .slice(0, 5);
      setAiSuggestions(cleaned.length ? cleaned : []);
      if (cleaned.length === 0) setAiError('No new suggestions — the AI didn\'t find anything in your library that improves on what you\'ve already cited.');
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'AI suggestion failed');
    } finally {
      setAiSuggesting(false);
    }
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
          <PaceMeter pace={pace} />
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
            onClick={async () => {
              const ok = await confirm({
                title: 'Delete document?',
                message: `"${doc.title || 'Untitled'}" — ${(doc.wordCount ?? 0).toLocaleString()} word${(doc.wordCount ?? 0) !== 1 ? 's' : ''}. This can't be undone.`,
                confirmLabel: 'Delete document',
                destructive: true,
              });
              if (ok) removeDocument(doc.id);
            }}
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
              <div className="mt-8 border-t border-slate-200 pt-6">
                <CrossRefsPanel sourceKind="document" sourceId={doc.id} />
              </div>
            </article>
          ) : (
            <div className="flex flex-col min-h-full">
              {/* AI co-writer toolbar */}
              <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-100 px-8 py-2 flex items-center gap-1.5 flex-wrap">
                <Wand2 size={13} className="text-violet-500 mr-0.5" />
                <ComposeBtn label="Continue"     onClick={() => compose('continue')}                busy={composing === 'continue'} disabled={!aiOn || !!composing} title="Write the next paragraph from where you are" />
                <ComposeBtn label="Expand"       onClick={() => compose('expand', { needsSelection: true })}   busy={composing === 'expand'}   disabled={!aiOn || !!composing || !hasSelection} title="Turn selected bullets/notes into prose" />
                <ComposeBtn label="Tighten"      onClick={() => compose('tighten', { needsSelection: true })}  busy={composing === 'tighten'}  disabled={!aiOn || !!composing || !hasSelection} title="Make the selection more concise" />
                <ComposeBtn label="Academic"     onClick={() => compose('academic', { needsSelection: true })} busy={composing === 'academic'} disabled={!aiOn || !!composing || !hasSelection} title="Rewrite the selection in formal academic tone" />
                <span className="w-px h-4 bg-slate-200 mx-1" />
                <ComposeBtn label="Abstract"     onClick={() => compose('abstract')}                busy={composing === 'abstract'} disabled={!aiOn || !!composing} title="Generate an abstract from the whole document (prepended)" />
                <ComposeBtn label="Related Work" onClick={() => compose('related')}                 busy={composing === 'related'}  disabled={!aiOn || !!composing} title="Draft a Related Work paragraph from your cited papers" />
                {!aiOn && <span className="text-[10px] text-slate-400 ml-1">configure AI in Settings</span>}
                {composeError && <span className="text-[10px] text-amber-700 ml-auto">{composeError}</span>}
              </div>
              <textarea
                ref={taRef}
                value={doc.content}
                onChange={e => updateActive({ content: e.target.value })}
                onSelect={e => { const t = e.currentTarget; setHasSelection(t.selectionStart !== t.selectionEnd); }}
                placeholder="# Introduction&#10;&#10;Start writing in Markdown… Select text and use the toolbar above, or insert citations from the right panel."
                className="flex-1 w-full px-8 py-8 bg-transparent border-none focus:outline-none resize-none text-[15px] leading-relaxed text-slate-800 font-mono"
                style={{ minHeight: 'calc(100vh - 160px)' }}
              />
            </div>
          )}
        </div>
      </div>

      {/* References rail */}
      {showRefs && (
        <aside className="w-80 shrink-0 bg-white border-l border-slate-200 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500">References</h3>
              <p className="text-xs text-slate-400 mt-0.5">{doc.paperRefs.length + doc.bookRefs.length} cited</p>
            </div>
            <button
              onClick={suggestCitations}
              disabled={!aiOn || aiSuggesting}
              title={aiOn ? `Ask ${aiName} to suggest citations from your library that fit what you're writing` : 'Configure an AI provider in Settings first'}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold border transition-all disabled:opacity-40 disabled:cursor-not-allowed text-violet-700 border-violet-200 hover:bg-violet-50"
            >
              {aiSuggesting ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
              {aiSuggesting ? 'thinking…' : 'AI suggest'}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-4">
            {/* AI suggestions */}
            {(aiSuggestions || aiError) && (
              <Section title="AI suggestions" hint={`via ${aiName}`}>
                {aiError && <p className="px-2 py-1 text-[10px] text-amber-700">{aiError}</p>}
                {aiSuggestions?.map(s => {
                  const p = savedPapers.find(x => x.arxivId === s.arxivId);
                  if (!p) return null;
                  return (
                    <div key={s.arxivId} className="px-2 py-1.5 rounded-md bg-violet-50 hover:bg-violet-100 transition-colors">
                      <button onClick={() => togglePaperRef(p)} className="w-full text-left">
                        <p className="text-xs font-medium text-slate-800 line-clamp-2">{p.title}</p>
                        <p className="text-[10px] text-violet-700 mt-1 italic line-clamp-2">"{s.reason}"</p>
                      </button>
                    </div>
                  );
                })}
                {aiSuggestions && (
                  <button onClick={() => { setAiSuggestions(null); setAiError(null); }}
                    className="text-[10px] text-slate-400 hover:text-slate-600 mt-1 px-2">
                    dismiss
                  </button>
                )}
              </Section>
            )}

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

// =========================================================================
// AI compose toolbar button
// =========================================================================

function ComposeBtn({ label, onClick, busy, disabled, title }: {
  label: string; onClick: () => void; busy: boolean; disabled: boolean; title: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="px-2 py-1 rounded-md text-[11px] font-medium border border-slate-200 text-slate-600 hover:bg-violet-50 hover:text-violet-700 hover:border-violet-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 transition-colors"
    >
      {busy && <Loader2 size={10} className="animate-spin" />}
      {label}
    </button>
  );
}

// =========================================================================
// Pace tracking — daily word goal + session delta + focus sprint
// =========================================================================

const GOAL_KEY = 'writer.dailyGoal';
const PROG_KEY = 'writer.progress';
const today = () => new Date().toISOString().slice(0, 10);

function readTodayWords(): number {
  try {
    const raw = JSON.parse(localStorage.getItem(PROG_KEY) || '{}');
    if (raw.date === today() && typeof raw.words === 'number') return raw.words;
  } catch { /* ignore */ }
  return 0;
}
function writeTodayWords(words: number) {
  try { localStorage.setItem(PROG_KEY, JSON.stringify({ date: today(), words })); } catch { /* ignore */ }
}

interface Pace {
  goal: number; setGoal: (n: number) => void;
  todayWords: number; session: number;
  sprintActive: boolean; sprintRemaining: number; sprintWords: number;
  startSprint: () => void; stopSprint: () => void;
}

function useWriterPace(wordCount: number): Pace {
  const [goal, setGoalState] = useState(() => {
    try { return parseInt(localStorage.getItem(GOAL_KEY) || '', 10) || 500; } catch { return 500; }
  });
  const [todayWords, setTodayWords] = useState(() => readTodayWords());
  const [session, setSession] = useState(0);
  const prev = useRef<number | null>(null);
  const sessionStart = useRef<number>(0);

  const [sprintEnd, setSprintEnd] = useState<number | null>(null);
  const [sprintStartWords, setSprintStartWords] = useState(0);
  const [now, setNow] = useState(Date.now());

  // Count only positive deltas toward today's total; track session growth.
  useEffect(() => {
    if (prev.current === null) { prev.current = wordCount; sessionStart.current = wordCount; return; }
    const delta = wordCount - prev.current;
    prev.current = wordCount;
    if (delta > 0) setTodayWords(t => { const nt = t + delta; writeTodayWords(nt); return nt; });
    setSession(wordCount - sessionStart.current);
  }, [wordCount]);

  // Tick the sprint clock.
  useEffect(() => {
    if (!sprintEnd) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sprintEnd]);
  useEffect(() => { if (sprintEnd && now >= sprintEnd) setSprintEnd(null); }, [now, sprintEnd]);

  const setGoal = (n: number) => {
    const v = Math.max(50, Math.min(20000, Math.round(n) || 500));
    setGoalState(v);
    try { localStorage.setItem(GOAL_KEY, String(v)); } catch { /* ignore */ }
  };
  const startSprint = () => { setSprintStartWords(wordCount); setNow(Date.now()); setSprintEnd(Date.now() + 25 * 60 * 1000); };
  const stopSprint = () => setSprintEnd(null);

  return {
    goal, setGoal, todayWords, session,
    sprintActive: !!sprintEnd,
    sprintRemaining: sprintEnd ? Math.max(0, sprintEnd - now) : 0,
    sprintWords: sprintEnd ? Math.max(0, wordCount - sprintStartWords) : 0,
    startSprint, stopSprint,
  };
}

function PaceMeter({ pace }: { pace: Pace }) {
  const [editing, setEditing] = useState(false);
  const pct = Math.min(100, Math.round((pace.todayWords / pace.goal) * 100));
  const done = pace.todayWords >= pace.goal;
  const mm = Math.floor(pace.sprintRemaining / 60000);
  const ss = Math.floor((pace.sprintRemaining % 60000) / 1000);

  return (
    <div className="flex items-center gap-2 shrink-0">
      <div className="flex items-center gap-1.5" title="Words written today vs. your daily goal">
        <Target size={12} className={done ? 'text-emerald-500' : 'text-slate-400'} />
        {editing ? (
          <input
            type="number"
            autoFocus
            defaultValue={pace.goal}
            onBlur={e => { pace.setGoal(parseInt(e.target.value, 10)); setEditing(false); }}
            onKeyDown={e => { if (e.key === 'Enter') { pace.setGoal(parseInt((e.target as HTMLInputElement).value, 10)); setEditing(false); } if (e.key === 'Escape') setEditing(false); }}
            className="w-16 text-xs border border-slate-200 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-400"
          />
        ) : (
          <button onClick={() => setEditing(true)} className={`text-xs font-medium ${done ? 'text-emerald-600' : 'text-slate-500'} hover:underline`}>
            {pace.todayWords}/{pace.goal}
          </button>
        )}
        <div className="w-14 h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div className={`h-full ${done ? 'bg-emerald-500' : 'bg-violet-500'}`} style={{ width: `${pct}%` }} />
        </div>
        {pace.session > 0 && <span className="text-[10px] text-violet-500 font-medium">+{pace.session}</span>}
      </div>
      {pace.sprintActive ? (
        <button
          onClick={pace.stopSprint}
          title={`Focus sprint — ${pace.sprintWords} words so far. Click to stop.`}
          className="flex items-center gap-1 text-xs font-medium text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded-md hover:bg-rose-100"
        >
          <Timer size={12} /> {mm}:{ss.toString().padStart(2, '0')}
        </button>
      ) : (
        <button
          onClick={pace.startSprint}
          title="Start a 25-minute focus sprint"
          className="p-1 rounded-md text-slate-400 hover:text-violet-600 hover:bg-slate-100"
        >
          <Timer size={13} />
        </button>
      )}
    </div>
  );
}

// =========================================================================
// Topic generator
// =========================================================================

interface TopicIdea { title: string; pitch: string; outline?: string[] }

function TopicGenerator({ onClose }: { onClose: () => void }) {
  const { settings } = usePapers();
  const { savedPapers } = useLibrary();
  const { newDocument } = useWriter();
  const aiOn = hasAI(settings);
  const aiName = providerLabel(resolveAIConfig(settings));

  // Prefill the area from the user's most-frequent library categories.
  const suggestedArea = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of savedPapers) for (const c of (p.categories || [])) counts.set(c, (counts.get(c) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c).join(', ');
  }, [savedPapers]);

  const [area, setArea] = useState(suggestedArea);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<TopicIdea[] | null>(null);

  async function generate() {
    if (!aiOn || loading) return;
    setLoading(true); setError(null); setIdeas(null);
    const libTitles = savedPapers.slice(0, 20).map(p => p.title).join('; ');
    const prompt = `You are a research advisor. Propose 6 concrete, non-obvious paper topics in the area(s) below. For each give: a specific title, a one-sentence pitch naming the gap it fills, and a 4–7 item section outline. Avoid generic "a survey of…" ideas. Return STRICT JSON ONLY — no prose, no fences.

AREA(S): ${area || '(researcher\'s choice — infer from the library below)'}

AUTHOR'S LIBRARY (titles, for grounding): ${libTitles || '(empty)'}

JSON shape:
[
  {"title": "...", "pitch": "one sentence", "outline": ["Introduction", "Related Work", "..."]}
]`;
    try {
      const text = await aiChat(
        [{ role: 'user', content: prompt }],
        settings,
        { maxTokens: 1400, temperature: 0.7, timeoutMs: 90_000, purpose: 'writer-topics' },
      );
      const parsed = extractJson<TopicIdea[]>(text, 'array');
      const cleaned = (Array.isArray(parsed) ? parsed : []).filter(t => t && t.title).slice(0, 8);
      if (cleaned.length === 0) throw new Error('No topics returned — try rephrasing the area.');
      setIdeas(cleaned);
    } catch (e) {
      setError(describeJsonError(e));
    } finally {
      setLoading(false);
    }
  }

  async function startDraft(idea: TopicIdea) {
    const { title, content } = docFromTopic(idea.title, idea.outline || []);
    await newDocument({ title, content });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl p-6 fade-in max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <Lightbulb size={18} className="text-violet-500" /> Generate topic ideas
          </h2>
          <button onClick={onClose} className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"><X size={16} /></button>
        </div>
        <p className="text-sm text-slate-500 mb-4">Describe your research area; {aiName} proposes specific paper angles with outlines.</p>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={area}
            onChange={e => setArea(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') generate(); }}
            placeholder="e.g. retrieval-augmented generation, robustness, cs.CR"
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
          <button
            onClick={generate}
            disabled={!aiOn || loading}
            className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 disabled:opacity-40 flex items-center gap-2"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {loading ? 'Thinking…' : 'Generate'}
          </button>
        </div>

        {!aiOn && <p className="text-xs text-amber-700">Configure an AI provider in Settings first.</p>}
        {error && <p className="text-xs text-amber-700 mb-2">{error}</p>}

        <div className="flex-1 overflow-y-auto space-y-2 -mx-1 px-1">
          {ideas?.map((idea, i) => (
            <div key={i} className="p-3.5 rounded-xl border border-slate-200 hover:border-violet-300 transition-colors">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{idea.title}</p>
                  <p className="text-xs text-slate-500 mt-1 italic">{idea.pitch}</p>
                  {idea.outline && idea.outline.length > 0 && (
                    <p className="text-[11px] text-slate-400 mt-1.5 line-clamp-2">{idea.outline.join(' · ')}</p>
                  )}
                </div>
                <button
                  onClick={() => startDraft(idea)}
                  className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-violet-700 border border-violet-200 rounded-lg hover:bg-violet-50"
                >
                  <Check size={12} /> Start draft
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
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
