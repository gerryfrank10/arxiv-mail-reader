import { useState, useEffect, useMemo } from 'react';
import { usePapers } from '../contexts/PapersContext';
import { useLibrary } from '../contexts/LibraryContext';
import { computeAssessment, ASSESSMENT_BADGE } from '../utils/assessment';
import { fetchCitationCounts } from '../utils/citations';
import { CATEGORY_COLORS, CATEGORY_COLORS_LIGHT, getCategoryLabel } from '../utils/categories';
import { format, subDays, isAfter } from 'date-fns';
import { BookOpen, BookMarked, Quote, TrendingUp, Clock, Filter } from 'lucide-react';

type Period = 'all' | '7d' | '30d' | '90d';
const PERIODS: Array<{ value: Period; label: string }> = [
  { value: '7d',  label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All time' },
];

export default function Dashboard() {
  const { papers, setSelectedPaper } = usePapers();
  const { savedPapers } = useLibrary();
  const [dashCat, setDashCat]     = useState('');
  const [period, setPeriod]       = useState<Period>('all');
  const [citations, setCitations] = useState<Record<string, number>>({});
  const [citLoading, setCitLoading] = useState(false);

  // Category counts (from ALL papers, unfiltered)
  const catCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of papers)
      for (const c of p.categories) counts[c] = (counts[c] ?? 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [papers]);

  // Dashboard-local filtered papers
  const dashPapers = useMemo(() => {
    let result = papers;
    if (dashCat) result = result.filter(p => p.categories.includes(dashCat));
    if (period !== 'all') {
      const cutoff = subDays(new Date(), period === '7d' ? 7 : period === '30d' ? 30 : 90);
      result = result.filter(p => isAfter(p.digestDate, cutoff));
    }
    return result;
  }, [papers, dashCat, period]);

  const topByScore = useMemo(() =>
    [...dashPapers]
      .map(p => ({ paper: p, assessment: computeAssessment(p) }))
      .sort((a, b) => b.assessment.score - a.assessment.score)
      .slice(0, 12),
    [dashPapers]
  );

  useEffect(() => {
    if (!topByScore.length) return;
    setCitLoading(true);
    fetchCitationCounts(topByScore.map(x => x.paper.arxivId)).then(data => {
      setCitations(data);
      setCitLoading(false);
    });
  }, [topByScore.map(x => x.paper.arxivId).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const topPapers = useMemo(() => {
    const hasCit = Object.keys(citations).length > 0;
    return [...topByScore]
      .map(({ paper, assessment }) => ({ paper, assessment, cit: citations[paper.arxivId] ?? null }))
      .sort((a, b) => {
        if (hasCit) {
          const diff = (b.cit ?? -1) - (a.cit ?? -1);
          if (diff !== 0) return diff;
        }
        return b.assessment.score - a.assessment.score;
      })
      .slice(0, 10);
  }, [topByScore, citations]);

  const recentPapers = useMemo(() =>
    [...dashPapers].sort((a, b) => b.digestDate.getTime() - a.digestDate.getTime()).slice(0, 8),
    [dashPapers]
  );

  if (papers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
          <BookOpen size={28} className="text-slate-400" />
        </div>
        <h2 className="text-xl font-semibold text-slate-700 mb-2">No papers yet</h2>
        <p className="text-slate-400 text-sm max-w-sm">Connect your email and sync to load arXiv digest emails.</p>
      </div>
    );
  }

  const digestCount  = new Set(papers.map(p => p.emailId)).size;
  const datesSorted  = [...papers].sort((a, b) => a.digestDate.getTime() - b.digestDate.getTime());
  const firstDate    = datesSorted[0]?.digestDate;
  const lastDate     = datesSorted[datesSorted.length - 1]?.digestDate;

  return (
    <div className="h-full overflow-y-auto main-scroll bg-slate-50">
      {/* ── Page header ── */}
      <div className="bg-white border-b border-slate-200 px-8 pt-6 pb-0">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">arXiv Papers</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                {papers.length} papers · {digestCount} digest{digestCount !== 1 ? 's' : ''}
                {firstDate && lastDate && firstDate.getTime() !== lastDate.getTime() && (
                  <> · <span className="text-slate-400">{format(firstDate, 'MMM d, yyyy')} – {format(lastDate, 'MMM d, yyyy')}</span></>
                )}
              </p>
            </div>
            {/* Quick stats row */}
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5 text-slate-500">
                <BookOpen size={14} className="text-blue-500" />
                <span className="font-semibold text-slate-800">{papers.length}</span> papers
              </div>
              <div className="flex items-center gap-1.5 text-slate-500">
                <BookMarked size={14} className="text-amber-500" />
                <span className="font-semibold text-slate-800">{savedPapers.length}</span> saved
              </div>
            </div>
          </div>

          {/* ── Category filter bar ── */}
          <div className="flex items-center gap-2 overflow-x-auto pb-0 hide-scrollbar -mx-1 px-1">
            <button
              onClick={() => setDashCat('')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-semibold border-b-2 whitespace-nowrap transition-all ${
                !dashCat
                  ? 'border-blue-500 text-blue-600 bg-blue-50/50'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Filter size={11} />
              All
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${!dashCat ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                {papers.length}
              </span>
            </button>
            {catCounts.slice(0, 14).map(([cat, count]) => {
              const lightColor = CATEGORY_COLORS_LIGHT[cat] ?? CATEGORY_COLORS_LIGHT.default;
              const active = dashCat === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setDashCat(active ? '' : cat)}
                  title={getCategoryLabel(cat)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-semibold border-b-2 whitespace-nowrap transition-all ${
                    active
                      ? `border-current ${lightColor}`
                      : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {cat}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${active ? 'bg-white/60' : 'bg-slate-100 text-slate-500'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 py-6 space-y-6">
        {/* ── Period filter ── */}
        <div className="flex items-center gap-2">
          <Clock size={13} className="text-slate-400" />
          <span className="text-xs text-slate-500 mr-1">Show:</span>
          {PERIODS.map(p => (
            <button key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                period === p.value
                  ? 'bg-slate-800 text-white'
                  : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300 hover:text-slate-700'
              }`}>
              {p.label}
            </button>
          ))}
          {dashPapers.length !== papers.length && (
            <span className="text-xs text-slate-400 ml-1">· {dashPapers.length} paper{dashPapers.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {/* ── Most Cited / Top Ranked ── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={15} className="text-emerald-500" />
            <h2 className="text-sm font-bold text-slate-700">
              {Object.keys(citations).length > 0 ? 'Most Cited Papers' : 'Top Ranked Papers'}
            </h2>
            <span className="text-xs text-slate-400 ml-auto flex items-center gap-1">
              <Quote size={10} />
              {citLoading ? 'fetching citations…' : Object.keys(citations).length > 0 ? 'Semantic Scholar' : 'by depth score'}
            </span>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {topPapers.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-8">No papers in this filter.</p>
            ) : topPapers.map(({ paper, assessment, cit }, idx) => (
              <button
                key={paper.id}
                onClick={() => setSelectedPaper(paper)}
                className={`w-full text-left px-5 py-4 flex items-start gap-4 hover:bg-slate-50 transition-colors group ${idx < topPapers.length - 1 ? 'border-b border-slate-100' : ''}`}
              >
                {/* Rank badge */}
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 font-bold text-xs ${
                  idx === 0 ? 'bg-amber-100 text-amber-700' :
                  idx === 1 ? 'bg-slate-100 text-slate-600' :
                  idx === 2 ? 'bg-orange-100 text-orange-700' :
                  'bg-slate-50 text-slate-500'
                }`}>
                  {idx + 1}
                </div>

                <div className="flex-1 min-w-0">
                  {/* Categories */}
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {paper.categories.slice(0, 3).map(cat => {
                      const color = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.default;
                      return <span key={cat} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${color}`}>{cat}</span>;
                    })}
                  </div>
                  <p className="text-sm font-semibold text-slate-800 leading-snug line-clamp-1 group-hover:text-blue-700 transition-colors">
                    {paper.title}
                  </p>
                  <p className="text-xs text-slate-400 mt-1 truncate">
                    {paper.authorList[0]}{paper.authorList.length > 1 ? ` +${paper.authorList.length - 1}` : ''} · {format(paper.digestDate, 'MMM d, yyyy')}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {cit !== null && (
                    <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full border border-emerald-200">
                      <Quote size={10} /> {cit.toLocaleString()}
                    </span>
                  )}
                  <span className={`text-[10px] font-semibold px-2 py-1 rounded-full border ${ASSESSMENT_BADGE[assessment.label]}`}>
                    {assessment.label}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* ── Recent papers ── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Clock size={15} className="text-blue-500" />
            <h2 className="text-sm font-bold text-slate-700">Recent Papers</h2>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {recentPapers.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-8">No papers in this filter.</p>
            ) : recentPapers.map((paper, idx) => {
              const assessment = computeAssessment(paper);
              return (
                <button
                  key={paper.id}
                  onClick={() => setSelectedPaper(paper)}
                  className={`w-full text-left px-5 py-3.5 flex items-center gap-4 hover:bg-slate-50 transition-colors group ${idx < recentPapers.length - 1 ? 'border-b border-slate-100' : ''}`}
                >
                  <div className="w-7 h-7 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0 text-xs font-bold text-slate-500">
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 line-clamp-1 group-hover:text-blue-700 transition-colors">{paper.title}</p>
                    <p className="text-xs text-slate-400 mt-0.5 truncate">
                      {paper.authorList[0]}{paper.authorList.length > 1 ? ` et al.` : ''} · {format(paper.digestDate, 'MMM d, yyyy')}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {paper.categories.slice(0, 2).map(cat => (
                      <span key={cat} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{cat}</span>
                    ))}
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${ASSESSMENT_BADGE[assessment.label]}`}>
                      {assessment.label}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
