import { useState, useMemo } from 'react';
import { FolderOpen, Plus, AlertCircle, Trash2, Edit2, Check, Circle, CircleDot, ArrowRight, Quote, BookOpen, FileText, GraduationCap, X } from 'lucide-react';
import { useCollections } from '../contexts/CollectionsContext';
import { useLibrary } from '../contexts/LibraryContext';
import { useBooks } from '../contexts/BooksContext';
import { useWriter } from '../contexts/WriterContext';
import { usePapers } from '../contexts/PapersContext';
import { Collection, CollectionItem, CollectionItemStatus, EntityKind } from '../types';
import { usePagination } from '../hooks/usePagination';
import Pager from './Pager';
import { TRACKER_COLOR_CLASSES, TRACKER_COLORS } from '../utils/trackerScoring';

export default function CollectionsView() {
  const { collections, dbEnabled, refresh } = useCollections();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing,  setEditing]  = useState<Collection | null>(null);
  const [creating, setCreating] = useState(false);

  const active = useMemo(
    () => collections.find(c => c.id === activeId) ?? collections[0] ?? null,
    [collections, activeId],
  );

  if (!dbEnabled) {
    return (
      <div className="h-full flex items-center justify-center px-8 bg-slate-50">
        <div className="max-w-md text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 mx-auto flex items-center justify-center mb-4">
            <AlertCircle size={28} className="text-amber-600" />
          </div>
          <h1 className="text-xl font-semibold text-slate-800 mb-2">Collections require server storage</h1>
          <p className="text-sm text-slate-500 leading-relaxed">
            Bundles of papers + books + documents live in Postgres so they persist across devices.
          </p>
          <button onClick={refresh} className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">Refresh</button>
        </div>
      </div>
    );
  }

  if (collections.length === 0) {
    return (
      <div className="h-full overflow-y-auto main-scroll bg-slate-50">
        <div className="max-w-3xl mx-auto px-8 py-16 fade-in">
          <div className="text-center">
            <div className="inline-flex w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 items-center justify-center text-white shadow-lg shadow-violet-500/30 mb-5">
              <FolderOpen size={28} />
            </div>
            <h1 className="text-2xl font-bold text-slate-800 mb-2">Bundle related work</h1>
            <p className="text-slate-500 max-w-md mx-auto leading-relaxed">
              Group papers, books, and your own drafts into themed Collections. Mark progress for learning paths.
            </p>
            <button onClick={() => setCreating(true)} className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white font-medium rounded-lg hover:bg-violet-700 shadow-sm shadow-violet-500/30">
              <Plus size={15} /> Create your first collection
            </button>
          </div>
        </div>
        {creating && <CollectionForm onClose={() => setCreating(false)} />}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto main-scroll bg-slate-50">
      <div className="max-w-6xl mx-auto px-8 py-8 fade-in">
        <div className="flex items-start justify-between mb-6 gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white shadow-sm">
              <FolderOpen size={20} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Collections</h1>
              <p className="text-sm text-slate-500">{collections.length} bundle{collections.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <button onClick={() => setCreating(true)} className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 shadow-sm">
            <Plus size={15} /> New collection
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1 mb-6 hide-scrollbar">
          {collections.map(c => {
            const cls = TRACKER_COLOR_CLASSES[c.color] ?? TRACKER_COLOR_CLASSES.blue;
            const isActive = active?.id === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setActiveId(c.id)}
                className={`shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium border transition-all ${
                  isActive ? `${cls.chip} ${cls.ring} ring-2 ring-offset-1` : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${cls.dot}`} />
                {c.kind === 'learning_path' && <GraduationCap size={11} />}
                <span>{c.name}</span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/70' : 'bg-slate-100 text-slate-500'}`}>
                  {c.items.length}
                </span>
              </button>
            );
          })}
        </div>

        {active && <ActiveCollection collection={active} onEdit={() => setEditing(active)} />}
      </div>

      {creating && <CollectionForm onClose={() => setCreating(false)} />}
      {editing && <CollectionForm collection={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// =========================================================================
// Active collection panel
// =========================================================================

function ActiveCollection({ collection, onEdit }: { collection: Collection; onEdit: () => void }) {
  const { setItemStatus, removeItem } = useCollections();
  const cls = TRACKER_COLOR_CLASSES[collection.color] ?? TRACKER_COLOR_CLASSES.blue;
  const [adderOpen, setAdderOpen] = useState(false);

  const progress = useMemo(() => {
    if (collection.items.length === 0) return 0;
    const done = collection.items.filter(i => i.status === 'done').length;
    return Math.round((done / collection.items.length) * 100);
  }, [collection.items]);

  // Sort once, then paginate
  const sortedItems = useMemo(
    () => [...collection.items].sort((a, b) => a.position - b.position),
    [collection.items],
  );
  const pager = usePagination(sortedItems, 20);

  return (
    <div>
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-5 shadow-sm">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-2.5 h-2.5 rounded-full ${cls.dot}`} />
              <h2 className="text-xl font-bold text-slate-800">{collection.name}</h2>
              {collection.kind === 'learning_path' && (
                <span className="text-[10px] uppercase tracking-wider font-semibold text-violet-700 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <GraduationCap size={9} /> Learning path
                </span>
              )}
            </div>
            {collection.description && <p className="text-sm text-slate-600 leading-relaxed">{collection.description}</p>}
            {collection.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {collection.tags.map(t => (
                  <span key={t} className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${cls.chip}`}>#{t}</span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setAdderOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700">
              <Plus size={11} /> Add item
            </button>
            <button onClick={onEdit} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50">
              <Edit2 size={11} /> Edit
            </button>
          </div>
        </div>
        {/* Progress bar for learning paths */}
        {collection.kind === 'learning_path' && collection.items.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-slate-500">Progress</span>
              <span className="text-xs font-bold text-slate-700">{progress}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className={`h-full ${cls.bar} transition-all`} style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Items */}
      {collection.items.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-8 text-center">
          <p className="text-sm text-slate-500">No items yet.</p>
          <button onClick={() => setAdderOpen(true)} className="mt-2 text-xs text-violet-600 hover:text-violet-800 font-medium">
            Add a paper, book, or document →
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-2.5">
            {pager.slice.map((item, idxInSlice) => (
              <CollectionItemRow
                key={`${item.targetKind}-${item.targetId}`}
                item={item}
                index={pager.page * pager.pageSize + idxInSlice}
                isLearningPath={collection.kind === 'learning_path'}
                onStatusChange={status => setItemStatus(collection.id, item.targetKind, item.targetId, status)}
                onRemove={() => removeItem(collection.id, item.targetKind, item.targetId)}
              />
            ))}
          </div>
          <div className="mt-4 rounded-lg border border-slate-200 bg-white overflow-hidden">
            <Pager pagination={pager} variant="light" size="md" label="items" pageSizes={[10, 20, 50]} />
          </div>
        </>
      )}

      {adderOpen && <AddItemModal collectionId={collection.id} existing={collection.items} onClose={() => setAdderOpen(false)} />}
    </div>
  );
}

// =========================================================================
// Item row
// =========================================================================

function CollectionItemRow({
  item, index, isLearningPath, onStatusChange, onRemove,
}: {
  item: CollectionItem;
  index: number;
  isLearningPath: boolean;
  onStatusChange: (s: CollectionItemStatus) => void;
  onRemove: () => void;
}) {
  const { papers, setSelectedPaper } = usePapers();
  const { savedPapers } = useLibrary();
  const { books } = useBooks();
  const { documents, setActiveId } = useWriter();

  const display = useMemo(() => {
    if (item.targetKind === 'paper') {
      const p = papers.find(x => x.arxivId === item.targetId) ?? savedPapers.find(x => x.arxivId === item.targetId);
      return p ? { title: p.title, sub: `${p.authorList[0] ?? '—'} · arXiv:${p.arxivId}`, paper: p } : { title: `arXiv:${item.targetId}`, sub: '(not loaded)' };
    }
    if (item.targetKind === 'book') {
      const b = books.find(x => x.id === item.targetId);
      return b ? { title: b.title, sub: `${b.authors[0] ?? '—'}${b.year ? ` · ${b.year}` : ''}` } : { title: item.targetId, sub: '(not loaded)' };
    }
    const d = documents.find(x => x.id === item.targetId);
    return d ? { title: d.title || 'Untitled', sub: `${d.wordCount ?? 0} words`, doc: d } : { title: item.targetId, sub: '(not loaded)' };
  }, [item, papers, savedPapers, books, documents]);

  const Icon = item.targetKind === 'paper' ? Quote : item.targetKind === 'book' ? BookOpen : FileText;

  function open() {
    if (item.targetKind === 'paper' && (display as any).paper)        setSelectedPaper((display as any).paper);
    else if (item.targetKind === 'document' && (display as any).doc)  setActiveId(item.targetId);
  }

  function cycle() {
    const next: CollectionItemStatus = item.status === 'unread' ? 'in_progress' : item.status === 'in_progress' ? 'done' : 'unread';
    onStatusChange(next);
  }

  const statusIcon =
    item.status === 'done'        ? <Check size={13} className="text-emerald-600" />
  : item.status === 'in_progress' ? <CircleDot size={13} className="text-blue-500" />
  : <Circle size={13} className="text-slate-300" />;

  return (
    <div className="group flex items-start gap-3 bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-sm transition-all">
      {isLearningPath && (
        <button
          onClick={cycle}
          title={`Mark as ${item.status === 'done' ? 'unread' : item.status === 'in_progress' ? 'done' : 'in progress'}`}
          className="shrink-0 w-7 h-7 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center hover:bg-slate-100 transition-colors"
        >
          {statusIcon}
        </button>
      )}
      {!isLearningPath && (
        <div className="shrink-0 w-7 h-7 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-xs font-semibold text-slate-500">
          {index + 1}
        </div>
      )}
      <Icon size={14} className="text-slate-400 mt-1 shrink-0" />
      <button onClick={open} className="flex-1 min-w-0 text-left">
        <p className="text-sm font-medium text-slate-800 line-clamp-1 group-hover:text-blue-700 transition-colors">{display.title}</p>
        <p className="text-xs text-slate-500 truncate mt-0.5">{display.sub}</p>
      </button>
      <button onClick={onRemove} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-all" title="Remove">
        <Trash2 size={12} />
      </button>
    </div>
  );
}

// =========================================================================
// Add-item modal
// =========================================================================

function AddItemModal({ collectionId, existing, onClose }: { collectionId: string; existing: CollectionItem[]; onClose: () => void }) {
  const { addItem } = useCollections();
  const { savedPapers } = useLibrary();
  const { books } = useBooks();
  const { documents } = useWriter();
  const [tab, setTab] = useState<EntityKind>('paper');
  const [query, setQuery] = useState('');

  const existingKey = useMemo(() => new Set(existing.map(i => `${i.targetKind}:${i.targetId}`)), [existing]);

  const list = useMemo(() => {
    const q = query.toLowerCase();
    if (tab === 'paper') {
      return savedPapers
        .filter(p => !existingKey.has(`paper:${p.arxivId}`))
        .filter(p => !q || p.title.toLowerCase().includes(q) || p.authors.toLowerCase().includes(q))
        .slice(0, 50)
        .map(p => ({ id: p.arxivId, title: p.title, sub: `${p.authorList[0] ?? '—'} · arXiv:${p.arxivId}` }));
    }
    if (tab === 'book') {
      return books
        .filter(b => !existingKey.has(`book:${b.id}`))
        .filter(b => !q || b.title.toLowerCase().includes(q) || b.authors.some(a => a.toLowerCase().includes(q)))
        .slice(0, 50)
        .map(b => ({ id: b.id, title: b.title, sub: `${b.authors[0] ?? '—'}${b.year ? ` · ${b.year}` : ''}` }));
    }
    return documents
      .filter(d => !existingKey.has(`document:${d.id}`))
      .filter(d => !q || (d.title || '').toLowerCase().includes(q))
      .slice(0, 50)
      .map(d => ({ id: d.id, title: d.title || 'Untitled', sub: `${d.wordCount ?? 0} words` }));
  }, [tab, query, savedPapers, books, documents, existingKey]);

  async function add(id: string) {
    await addItem(collectionId, { targetKind: tab, targetId: id });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl p-5 max-h-[80vh] overflow-hidden flex flex-col fade-in">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2"><Plus size={16} className="text-violet-500" /> Add to collection</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X size={16} /></button>
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1 mb-3 w-fit">
          {(['paper','book','document'] as EntityKind[]).map(k => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${tab === k ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}>
              {k === 'paper' ? 'Papers (library)' : k === 'book' ? 'Books' : 'Documents'}
            </button>
          ))}
        </div>
        <input
          type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter…" autoFocus
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
        />
        <div className="flex-1 overflow-y-auto -mx-1 space-y-1">
          {list.length === 0 ? (
            <p className="text-center text-sm text-slate-400 py-8">{existingKey.size > 0 && tab === 'paper' ? 'Everything from your library is already here.' : `No ${tab}s available.`}</p>
          ) : list.map(it => (
            <button key={it.id} onClick={() => add(it.id)}
              className="w-full flex items-start gap-2 px-3 py-2 text-left rounded-lg hover:bg-violet-50 transition-colors group">
              <Plus size={11} className="text-slate-400 group-hover:text-violet-600 mt-1" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 line-clamp-1">{it.title}</p>
                <p className="text-xs text-slate-500 truncate">{it.sub}</p>
              </div>
              <ArrowRight size={11} className="text-violet-400 mt-1 shrink-0 opacity-0 group-hover:opacity-100" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// Collection form (create + edit)
// =========================================================================

function CollectionForm({ collection, onClose }: { collection?: Collection; onClose: () => void }) {
  const { createCollection, updateCollection, removeCollection } = useCollections();
  const editing = !!collection;
  const [name,        setName]        = useState(collection?.name ?? '');
  const [description, setDescription] = useState(collection?.description ?? '');
  const [color,       setColor]       = useState(collection?.color ?? 'violet');
  const [kind,        setKind]        = useState(collection?.kind ?? 'collection');
  const [tags,        setTags]        = useState((collection?.tags ?? []).join(', '));
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save() {
    if (!name.trim()) return;
    const payload = {
      name: name.trim(), description: description.trim(), color, kind,
      tags: tags.split(',').map(s => s.trim()).filter(Boolean),
    };
    if (editing) await updateCollection(collection!.id, payload);
    else         await createCollection(payload);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl p-6 fade-in">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2"><FolderOpen size={18} className="text-violet-500" />{editing ? 'Edit' : 'New'} collection</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Name</label>
            <input value={name} onChange={e => setName(e.target.value)} autoFocus
              placeholder="e.g. World models survey path"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40 resize-y" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Color</label>
              <div className="flex gap-2 flex-wrap">
                {TRACKER_COLORS.map(c => {
                  const cls = TRACKER_COLOR_CLASSES[c];
                  return (
                    <button key={c} onClick={() => setColor(c)} title={c}
                      className={`w-6 h-6 rounded-full ${cls.dot} transition-all ${color === c ? `ring-2 ring-offset-2 ${cls.ring}` : 'opacity-60 hover:opacity-100'}`} />
                  );
                })}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Type</label>
              <div className="flex gap-2">
                <button onClick={() => setKind('collection')}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md border transition-all ${kind === 'collection' ? 'bg-slate-100 border-slate-300 text-slate-800' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                  Collection
                </button>
                <button onClick={() => setKind('learning_path')}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md border transition-all flex items-center justify-center gap-1 ${kind === 'learning_path' ? 'bg-violet-100 border-violet-300 text-violet-800' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                  <GraduationCap size={11} /> Learning path
                </button>
              </div>
              <p className="text-[10px] text-slate-400 mt-1.5">Learning paths track progress per item.</p>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Tags <span className="text-xs text-slate-400 font-normal">(comma-separated)</span></label>
            <input value={tags} onChange={e => setTags(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/40" />
          </div>
        </div>
        <div className="mt-6 flex items-center gap-3">
          {editing && (
            <button onClick={async () => {
                if (confirmDelete) { await removeCollection(collection!.id); onClose(); }
                else setConfirmDelete(true);
              }}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg transition-colors ${confirmDelete ? 'bg-red-600 text-white hover:bg-red-700' : 'text-red-600 hover:bg-red-50'}`}>
              <Trash2 size={13} />{confirmDelete ? 'Click again' : 'Delete'}
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={!name.trim()}
            className="px-5 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 disabled:opacity-40">
            {editing ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
