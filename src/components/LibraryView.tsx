import { useRef, useState } from 'react';
import { BookMarked, Search, Trash2, ExternalLink, BarChart2, Download, Heart, Database, X } from 'lucide-react';
import { useLibrary } from '../contexts/LibraryContext';
import { usePapers } from '../contexts/PapersContext';
import { cachePaperFile } from '../utils/researchApi';
import { computeAssessment, ASSESSMENT_BADGE, ASSESSMENT_BAR } from '../utils/assessment';
import { CATEGORY_COLORS_LIGHT, getCategoryLabel } from '../utils/categories';
import { downloadBibFile } from '../utils/citationFormats';
import { format } from 'date-fns';

export default function LibraryView() {
  const { savedPapers, unsavePaper, likedPapers, unlikePaper } = useLibrary();
  const { setSelectedPaper, storageMode, updatePaperMeta } = usePapers();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'saved' | 'liked'>('saved');
  const [cacheProgress, setCacheProgress] = useState<{ done: number; total: number; running: boolean } | null>(null);
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);
  const cancelCache = useRef(false);

  async function cacheAllPdfs() {
    const targets = source.filter(p => !p.filePath && !p.arxivId.startsWith('local:'));
    if (targets.length === 0) {
      setCacheMessage('Every paper in this tab already has a cached PDF.');
      return;
    }
    cancelCache.current = false;
    setCacheMessage(null);
    setCacheProgress({ done: 0, total: targets.length, running: true });
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < targets.length; i++) {
      if (cancelCache.current) break;
      try {
        const res = await cachePaperFile(targets[i].id);
        updatePaperMeta(targets[i].id, {
          filePath: res.paper.filePath, fileSize: res.paper.fileSize,
          mimeType: res.paper.mimeType, originalFilename: res.paper.originalFilename,
          uploadedAt: res.paper.uploadedAt, hasFullText: res.paper.hasFullText,
          fullTextChars: res.paper.fullTextChars,
        });
        ok++;
      } catch { failed++; }
      setCacheProgress({ done: i + 1, total: targets.length, running: !cancelCache.current });
    }
    setCacheProgress(prev => prev ? { ...prev, running: false } : null);
    setCacheMessage(
      `${ok} PDF${ok === 1 ? '' : 's'} cached${failed ? `, ${failed} failed` : ''}.` +
      (cancelCache.current ? ' Cancelled.' : ' Text extraction continues in the background.'),
    );
  }

  const isLikedTab = tab === 'liked';
  const source = isLikedTab ? likedPapers : savedPapers;
  const remove = isLikedTab ? unlikePaper : unsavePaper;

  const displayed = source.filter(p => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      p.title.toLowerCase().includes(q) ||
      p.authors.toLowerCase().includes(q) ||
      p.abstract.toLowerCase().includes(q) ||
      p.arxivId.includes(q)
    );
  });

  const total    = source.length;
  const inDepth  = source.filter(p => computeAssessment(p).label === 'In Depth').length;
  const avgScore = total
    ? Math.round(source.reduce((sum, p) => sum + computeAssessment(p).score, 0) / total)
    : 0;

  // Only show the full empty state when BOTH collections are empty.
  if (savedPapers.length === 0 && likedPapers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
          <BookMarked size={28} className="text-slate-400" />
        </div>
        <h2 className="text-xl font-semibold text-slate-700 mb-2">Your library is empty</h2>
        <p className="text-slate-400 text-sm max-w-sm">
          Bookmark a paper to save it here, or tap the heart to like one — both live in this view.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto main-scroll">
      <div className="max-w-5xl mx-auto px-8 py-8 fade-in">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <BookMarked size={22} className="text-amber-500" />
              Your Library
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              {savedPapers.length} saved · {likedPapers.length} liked
            </p>
          </div>
          <div className="flex items-center gap-2">
            {storageMode === 'server' && (
              <button
                onClick={cacheAllPdfs}
                disabled={cacheProgress?.running}
                title="Download and store the PDFs for these papers on your server (about 3s each, arXiv rate limit). Text is extracted automatically."
                className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Database size={14} />
                {cacheProgress?.running
                  ? `Caching ${cacheProgress.done}/${cacheProgress.total}…`
                  : 'Cache PDFs'}
              </button>
            )}
            <button
              onClick={() => downloadBibFile(source, `arxiv-${tab}-${format(new Date(), 'yyyy-MM-dd')}.bib`)}
              title={`Export ${tab} papers as a BibTeX file`}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
            >
              <Download size={14} />
              Export .bib
            </button>
          </div>
        </div>

        {cacheProgress?.running && (
          <div className="mb-4 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-700">
            <svg className="animate-spin w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span>Downloading PDFs — {cacheProgress.done} of {cacheProgress.total}</span>
                <span className="text-xs text-blue-500">~3s each (arXiv rate limit)</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-blue-100 overflow-hidden">
                <div className="h-full bg-blue-500 transition-all" style={{ width: `${(cacheProgress.done / Math.max(cacheProgress.total, 1)) * 100}%` }} />
              </div>
            </div>
            <button
              onClick={() => { cancelCache.current = true; }}
              title="Stop after the current download"
              className="p-1 rounded hover:bg-blue-100"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {cacheMessage && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-600">
            <span className="flex-1">{cacheMessage}</span>
            <button onClick={() => setCacheMessage(null)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
          </div>
        )}

        {/* Saved / Liked tabs */}
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit mb-6">
          <button
            onClick={() => setTab('saved')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-sm font-medium transition-all ${tab === 'saved' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <BookMarked size={13} className={tab === 'saved' ? 'text-amber-500' : ''} /> Saved
            <span className="text-[11px] text-slate-400">{savedPapers.length}</span>
          </button>
          <button
            onClick={() => setTab('liked')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-sm font-medium transition-all ${tab === 'liked' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <Heart size={13} className={tab === 'liked' ? 'text-rose-500 fill-current' : ''} /> Liked
            <span className="text-[11px] text-slate-400">{likedPapers.length}</span>
          </button>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm text-center">
            <p className="text-2xl font-bold text-slate-800">{total}</p>
            <p className="text-xs text-slate-500 mt-0.5">{isLikedTab ? 'Total liked' : 'Total saved'}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm text-center">
            <p className="text-2xl font-bold text-emerald-600">{inDepth}</p>
            <p className="text-xs text-slate-500 mt-0.5">In Depth</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm text-center">
            <p className="text-2xl font-bold text-blue-600">{avgScore}</p>
            <p className="text-xs text-slate-500 mt-0.5">Avg. score</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-5">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={`Search ${isLikedTab ? 'liked' : 'saved'} papers…`}
            className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
          />
        </div>

        {/* Paper grid */}
        {displayed.length === 0 && (
          <p className="text-center text-slate-400 text-sm py-8">
            {source.length === 0
              ? (isLikedTab ? 'No liked papers yet — tap the heart on any paper.' : 'No saved papers yet — bookmark papers from your inbox.')
              : 'No papers match your search.'}
          </p>
        )}

        <div className="space-y-4">
          {displayed.map(paper => {
            const assessment = computeAssessment(paper);
            return (
              <div
                key={paper.id}
                className="bg-white rounded-xl border border-slate-200 p-5 hover:border-blue-300 hover:shadow-sm transition-all group"
              >
                {/* Top: categories + assessment + unsave */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex flex-wrap gap-1.5">
                    {paper.categories.map(cat => {
                      const color = CATEGORY_COLORS_LIGHT[cat] ?? CATEGORY_COLORS_LIGHT.default;
                      return (
                        <span key={cat} className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${color}`} title={getCategoryLabel(cat)}>
                          {cat}
                        </span>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${ASSESSMENT_BADGE[assessment.label]}`}>
                      {assessment.label}
                    </span>
                    <button
                      onClick={() => remove(paper.id)}
                      title={isLikedTab ? 'Unlike' : 'Remove from library'}
                      className="p-1.5 rounded-lg text-slate-300 hover:text-red-400 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Title */}
                <button
                  onClick={() => setSelectedPaper(paper)}
                  className="text-left w-full"
                >
                  <h3 className="text-base font-semibold text-slate-800 leading-snug mb-1.5 hover:text-blue-700 transition-colors line-clamp-2">
                    {paper.title}
                  </h3>
                </button>

                {/* Authors */}
                <p className="text-sm text-slate-500 mb-3 truncate">
                  {paper.authors}
                </p>

                {/* Score bar */}
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-slate-400 flex items-center gap-1">
                      <BarChart2 size={11} />
                      Depth score
                    </span>
                    <span className="text-[11px] font-bold text-slate-600">{assessment.score}/100</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${ASSESSMENT_BAR[assessment.label]}`}
                      style={{ width: `${assessment.score}%` }}
                    />
                  </div>
                </div>

                {/* Signals */}
                {assessment.signals.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {assessment.signals.map(s => (
                      <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200 text-slate-500">
                        {s}
                      </span>
                    ))}
                  </div>
                )}

                {/* Abstract snippet */}
                <p className="text-xs text-slate-500 line-clamp-2 mb-3 leading-relaxed">
                  {paper.abstract}
                </p>

                {/* Footer */}
                <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                  <p className="text-xs text-slate-400">
                    {format(paper.digestDate, 'MMM d, yyyy')} · arXiv:{paper.arxivId}
                    {paper.size && ` · ${paper.size}`}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedPaper(paper)}
                      className="text-xs text-blue-600 font-medium hover:text-blue-700 transition-colors"
                    >
                      Full detail →
                    </button>
                    <a
                      href={paper.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="p-1 rounded text-slate-400 hover:text-blue-500 transition-colors"
                    >
                      <ExternalLink size={13} />
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
