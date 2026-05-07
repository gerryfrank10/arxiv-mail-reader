import { useState } from 'react';
import { BookMarked, Search, Trash2, ExternalLink, BarChart2 } from 'lucide-react';
import { useLibrary } from '../contexts/LibraryContext';
import { usePapers } from '../contexts/PapersContext';
import { computeAssessment, ASSESSMENT_BADGE, ASSESSMENT_BAR } from '../utils/assessment';
import { CATEGORY_COLORS_LIGHT, getCategoryLabel } from '../utils/categories';
import { format } from 'date-fns';

export default function LibraryView() {
  const { savedPapers, unsavePaper } = useLibrary();
  const { setSelectedPaper } = usePapers();
  const [query, setQuery] = useState('');

  const displayed = savedPapers.filter(p => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      p.title.toLowerCase().includes(q) ||
      p.authors.toLowerCase().includes(q) ||
      p.abstract.toLowerCase().includes(q) ||
      p.arxivId.includes(q)
    );
  });

  const totalSaved = savedPapers.length;
  const inDepth  = savedPapers.filter(p => computeAssessment(p).label === 'In Depth').length;
  const avgScore = totalSaved
    ? Math.round(savedPapers.reduce((sum, p) => sum + computeAssessment(p).score, 0) / totalSaved)
    : 0;

  if (totalSaved === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
          <BookMarked size={28} className="text-slate-400" />
        </div>
        <h2 className="text-xl font-semibold text-slate-700 mb-2">Your library is empty</h2>
        <p className="text-slate-400 text-sm max-w-sm">
          Click the bookmark icon on any paper to save it here permanently — no expiry, always available.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto main-scroll">
      <div className="max-w-5xl mx-auto px-8 py-8 fade-in">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <BookMarked size={22} className="text-amber-500" />
              Your Library
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              {totalSaved} saved paper{totalSaved !== 1 ? 's' : ''} — stored permanently
            </p>
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm text-center">
            <p className="text-2xl font-bold text-slate-800">{totalSaved}</p>
            <p className="text-xs text-slate-500 mt-0.5">Total saved</p>
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
            placeholder="Search saved papers…"
            className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
          />
        </div>

        {/* Paper grid */}
        {displayed.length === 0 && (
          <p className="text-center text-slate-400 text-sm py-8">No papers match your search.</p>
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
                      onClick={() => unsavePaper(paper.id)}
                      title="Remove from library"
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
