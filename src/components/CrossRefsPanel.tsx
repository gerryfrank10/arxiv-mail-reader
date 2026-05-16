import { useMemo, useState } from 'react';
import { Link as LinkIcon, X, Plus, Quote, BookOpen, FileText, ChevronDown, FolderOpen } from 'lucide-react';
import { EntityKind, LinkRel } from '../types';
import { useLinks } from '../contexts/LinksContext';
import { useLibrary } from '../contexts/LibraryContext';
import { useBooks } from '../contexts/BooksContext';
import { useWriter } from '../contexts/WriterContext';
import { useCollections } from '../contexts/CollectionsContext';
import { usePapers } from '../contexts/PapersContext';

interface Props {
  sourceKind: EntityKind;
  sourceId:   string;
  /** Optional label override for the inline collection chips */
  title?: string;
}

const REL_LABEL: Record<LinkRel, string> = {
  related:      'related',
  cites:        'cites',
  extends:      'extends',
  contradicts:  'contradicts',
  background:   'background',
};

const REL_COLOR: Record<LinkRel, string> = {
  related:      'bg-slate-100 text-slate-700 border-slate-300',
  cites:        'bg-blue-50 text-blue-700 border-blue-200',
  extends:      'bg-emerald-50 text-emerald-700 border-emerald-200',
  contradicts:  'bg-red-50 text-red-700 border-red-200',
  background:   'bg-amber-50 text-amber-700 border-amber-200',
};

/**
 * Compact cross-reference panel. Shows:
 *   - which Collections include this entity
 *   - existing Links (both ways)
 *   - a + button to add a new link with rel-type + target picker
 */
export default function CrossRefsPanel({ sourceKind, sourceId, title = 'Cross-references' }: Props) {
  const { dbEnabled, linksFor, addLink, removeLink } = useLinks();
  const { collectionsContaining, dbEnabled: collsDbEnabled } = useCollections();
  const [adding, setAdding] = useState(false);

  if (!dbEnabled && !collsDbEnabled) return null;

  const myLinks = linksFor(sourceKind, sourceId);
  const myColls = collectionsContaining(sourceKind, sourceId);

  return (
    <section className="mt-8 mb-10">
      <div className="flex items-center gap-2 mb-3">
        <LinkIcon size={14} className="text-slate-500" />
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">{title}</h2>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="ml-auto text-[11px] flex items-center gap-1 text-slate-500 hover:text-blue-600 transition-colors"
          >
            <Plus size={11} /> link
          </button>
        )}
      </div>

      {/* Collections */}
      {myColls.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {myColls.map(c => (
            <span
              key={c.id}
              className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200 flex items-center gap-1"
              title={`In collection: ${c.name}`}
            >
              <FolderOpen size={9} />
              {c.name}
            </span>
          ))}
        </div>
      )}

      {/* Add link form */}
      {adding && (
        <AddLinkForm
          sourceKind={sourceKind}
          sourceId={sourceId}
          onSubmit={async (data) => {
            await addLink({ sourceKind, sourceId, ...data });
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {/* Existing links */}
      {myLinks.length === 0 && myColls.length === 0 && !adding && (
        <p className="text-xs text-slate-400 italic">No cross-references yet.</p>
      )}

      {myLinks.length > 0 && (
        <div className="space-y-1.5">
          {myLinks.map((l, i) => {
            const isOutgoing = l.sourceKind === sourceKind && l.sourceId === sourceId;
            const otherKind  = isOutgoing ? l.targetKind : l.sourceKind;
            const otherId    = isOutgoing ? l.targetId   : l.sourceId;
            return (
              <LinkRow
                key={`${l.sourceKind}:${l.sourceId}-${l.targetKind}:${l.targetId}-${l.rel}-${i}`}
                kind={otherKind}
                id={otherId}
                rel={l.rel}
                direction={isOutgoing ? 'out' : 'in'}
                note={l.note}
                onRemove={() => removeLink({
                  sourceKind: l.sourceKind, sourceId: l.sourceId,
                  targetKind: l.targetKind, targetId: l.targetId,
                  rel: l.rel,
                })}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

// =========================================================================
// Link row — resolves the target into a clickable, well-labelled item
// =========================================================================

function LinkRow({
  kind, id, rel, direction, note, onRemove,
}: {
  kind: EntityKind;
  id: string;
  rel: LinkRel;
  direction: 'in' | 'out';
  note: string;
  onRemove: () => void;
}) {
  const { papers, setSelectedPaper } = usePapers();
  const { savedPapers } = useLibrary();
  const { books } = useBooks();
  const { documents, setActiveId } = useWriter();

  const display = useMemo(() => {
    if (kind === 'paper') {
      const p = papers.find(x => x.arxivId === id) ?? savedPapers.find(x => x.arxivId === id);
      return p ? { title: p.title, sub: `${p.authorList[0] ?? '—'} · arXiv:${p.arxivId}`, paper: p } : { title: `arXiv:${id}`, sub: '(not in library)' };
    }
    if (kind === 'book') {
      const b = books.find(x => x.id === id);
      return b ? { title: b.title, sub: `${b.authors[0] ?? '—'}${b.year ? ` · ${b.year}` : ''}` } : { title: id, sub: '(book not loaded)' };
    }
    const d = documents.find(x => x.id === id);
    return d ? { title: d.title || 'Untitled', sub: `${d.wordCount ?? 0} words`, doc: d } : { title: id, sub: '(document not loaded)' };
  }, [kind, id, papers, savedPapers, books, documents]);

  const Icon = kind === 'paper' ? Quote : kind === 'book' ? BookOpen : FileText;

  function open() {
    if (kind === 'paper' && (display as any).paper) setSelectedPaper((display as any).paper);
    else if (kind === 'document' && (display as any).doc) setActiveId(id);
  }

  return (
    <div className="group flex items-start gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:border-slate-300 transition-colors">
      <Icon size={13} className="text-slate-400 mt-0.5 shrink-0" />
      <button onClick={open} className="flex-1 min-w-0 text-left">
        <p className="text-sm font-medium text-slate-800 line-clamp-1 group-hover:text-blue-700 transition-colors">{display.title}</p>
        <p className="text-xs text-slate-500 truncate mt-0.5">{display.sub}</p>
        {note && <p className="text-xs text-slate-500 italic mt-1">{note}</p>}
      </button>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${REL_COLOR[rel]}`}>
          {direction === 'in' ? '←' : '→'} {REL_LABEL[rel]}
        </span>
        <button onClick={onRemove} className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all" title="Remove link">
          <X size={11} />
        </button>
      </div>
    </div>
  );
}

// =========================================================================
// Add-link form
// =========================================================================

function AddLinkForm({
  sourceKind, sourceId, onSubmit, onCancel,
}: {
  sourceKind: EntityKind;
  sourceId: string;
  onSubmit: (data: { targetKind: EntityKind; targetId: string; rel: LinkRel; note: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const { savedPapers } = useLibrary();
  const { books } = useBooks();
  const { documents } = useWriter();
  const [kind, setKind] = useState<EntityKind>('paper');
  const [rel,  setRel]  = useState<LinkRel>('related');
  const [targetId, setTargetId] = useState('');
  const [note, setNote] = useState('');

  // Candidate lists per kind, excluding self
  const candidates = useMemo(() => {
    if (kind === 'paper') return savedPapers.map(p => ({ id: p.arxivId, label: p.title, sub: p.authorList[0] ?? '' }));
    if (kind === 'book')  return books.map(b => ({ id: b.id, label: b.title, sub: b.authors[0] ?? '' }));
    return documents.map(d => ({ id: d.id, label: d.title || 'Untitled', sub: `${d.wordCount ?? 0} words` }));
  }, [kind, savedPapers, books, documents])
    .filter(c => !(c.id === sourceId && kind === sourceKind));

  async function handle() {
    if (!targetId) return;
    await onSubmit({ targetKind: kind, targetId, rel, note: note.trim() });
  }

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 mb-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="relative">
          <select value={kind} onChange={e => { setKind(e.target.value as EntityKind); setTargetId(''); }}
            className="w-full pl-2.5 pr-8 py-1.5 border border-slate-200 rounded-md text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500/40 appearance-none">
            <option value="paper">Paper</option>
            <option value="book">Book</option>
            <option value="document">Document</option>
          </select>
          <ChevronDown size={11} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>
        <div className="relative">
          <select value={rel} onChange={e => setRel(e.target.value as LinkRel)}
            className="w-full pl-2.5 pr-8 py-1.5 border border-slate-200 rounded-md text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500/40 appearance-none">
            <option value="related">related</option>
            <option value="cites">cites</option>
            <option value="extends">extends</option>
            <option value="contradicts">contradicts</option>
            <option value="background">background</option>
          </select>
          <ChevronDown size={11} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>
      </div>

      <div className="relative">
        <select value={targetId} onChange={e => setTargetId(e.target.value)}
          className="w-full pl-2.5 pr-8 py-1.5 border border-slate-200 rounded-md text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500/40 appearance-none">
          <option value="">Pick a {kind}…</option>
          {candidates.map(c => (
            <option key={c.id} value={c.id}>
              {c.label.length > 60 ? c.label.slice(0, 58) + '…' : c.label}
            </option>
          ))}
        </select>
        <ChevronDown size={11} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
      </div>

      <input
        type="text"
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Note (optional)"
        className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-blue-500/40"
      />

      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1">Cancel</button>
        <button onClick={handle} disabled={!targetId}
          className="text-xs bg-blue-600 text-white px-3 py-1 rounded-md hover:bg-blue-700 disabled:opacity-40">
          Add link
        </button>
      </div>
    </div>
  );
}
