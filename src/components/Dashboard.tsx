import { useState, useEffect, useMemo } from 'react';
import { usePapers } from '../contexts/PapersContext';
import { computeAssessment, ASSESSMENT_BADGE } from '../utils/assessment';
import { fetchCitationCounts } from '../utils/citations';
import { CATEGORY_COLORS, CATEGORY_COLORS_LIGHT, getCategoryLabel } from '../utils/categories';
import { computeAuthorStats, groupByVenue, detectVenue, type AuthorStat, type VenueGroup, FEATURED_AUTHORS } from '../utils/conferences';
import { format, subDays, isAfter } from 'date-fns';
import { BookOpen, Quote, TrendingUp, Clock, Filter, Users, Presentation, ChevronRight, ArrowUpDown, Award } from 'lucide-react';
import { usePagination } from '../hooks/usePagination';
import Pager from './Pager';
import type { Paper } from '../types';

type Tab = 'overview' | 'authors' | 'conferences';
type Period = 'all' | '7d' | '30d' | '90d';
const PERIODS: Array<{ value: Period; label: string }> = [
  { value: '7d',  label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All time' },
];

const TABS: Array<{ value: Tab; label: string; icon: React.ReactNode }> = [
  { value: 'overview',     label: 'Overview',    icon: <TrendingUp size={13} /> },
  { value: 'authors',      label: 'Authors',     icon: <Users size={13} /> },
  { value: 'conferences',  label: 'Conferences', icon: <Presentation size={13} /> },
];

export default function Dashboard() {
  const { papers, setSelectedPaper, stats, readIds } = usePapers();
  const [tab, setTab] = useState<Tab>('overview');

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

  return (
    <div className="h-full overflow-y-auto main-scroll bg-slate-50">
      {/* ── Page header with tabs ── */}
      <div className="bg-white border-b border-slate-200 px-8 pt-6 pb-0">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">arXiv Papers</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                {(stats?.total ?? papers.length).toLocaleString()} papers
                {stats && (
                  <span className="text-slate-400">
                    {' · '}
                    {Math.max(0, stats.total - readIds.size).toLocaleString()} unread
                    {' · '}{stats.saved.toLocaleString()} saved
                  </span>
                )}
              </p>
            </div>
            {/* Tab bar */}
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
              {TABS.map(t => (
                <button
                  key={t.value}
                  onClick={() => setTab(t.value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    tab === t.value ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Tab content ── */}
      {tab === 'overview' && <OverviewTab papers={papers} setSelectedPaper={setSelectedPaper} />}
      {tab === 'authors' && <AuthorsTab papers={papers} setSelectedPaper={setSelectedPaper} />}
      {tab === 'conferences' && <ConferencesTab papers={papers} setSelectedPaper={setSelectedPaper} />}
    </div>
  );
}

// =========================================================================
// Overview tab — the original dashboard
// =========================================================================

function OverviewTab({ papers, setSelectedPaper }: {
  papers: ReturnType<typeof usePapers>['papers'];
  setSelectedPaper: (p: ReturnType<typeof usePapers>['papers'][0]) => void;
}) {
  const [dashCat, setDashCat] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [citations, setCitations] = useState<Record<string, number>>({});
  const [citLoading, setCitLoading] = useState(false);

  const { stats } = usePapers();
  const catCounts = useMemo<Array<[string, number]>>(() => {
    // Server mode: counts cover the whole library, not just the loaded window.
    if (stats?.categories.length) {
      return stats.categories.map(c => [c.category, c.count]);
    }
    const counts: Record<string, number> = {};
    for (const p of papers)
      for (const c of p.categories) counts[c] = (counts[c] ?? 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [papers, stats]);

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

  return (
    <>
      {/* Category filter bar */}
      <div className="bg-white border-b border-slate-200 px-8 pb-0">
        <div className="max-w-5xl mx-auto">
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
                {stats?.total ?? papers.length}
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
        {/* Period filter */}
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

        {/* Top papers */}
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
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 font-bold text-xs ${
                  idx === 0 ? 'bg-amber-100 text-amber-700' :
                  idx === 1 ? 'bg-slate-100 text-slate-600' :
                  idx === 2 ? 'bg-orange-100 text-orange-700' :
                  'bg-slate-50 text-slate-500'
                }`}>
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
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

        {/* Recent papers */}
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
    </>
  );
}

// =========================================================================
// Authors tab — top authors with featured researchers + pagination
// =========================================================================

function AuthorsTab({ papers, setSelectedPaper }: {
  papers: ReturnType<typeof usePapers>['papers'];
  setSelectedPaper: (p: ReturnType<typeof usePapers>['papers'][0]) => void;
}) {
  const [query, setQuery] = useState('');
  const [selectedAuthor, setSelectedAuthor] = useState<AuthorStat | null>(null);

  const allStats = useMemo(() => computeAuthorStats(papers), [papers]);

  // Featured authors found in the user's papers (matched by name)
  const featuredFound = useMemo(() => {
    return FEATURED_AUTHORS.map(fa => {
      // Match case-insensitively against the authorList of every paper
      const matchName = fa.matchName.toLowerCase();
      const authorStat = allStats.find(a => a.name.toLowerCase().includes(matchName));
      return authorStat ? { featured: fa, stat: authorStat } : null;
    }).filter(Boolean) as Array<{ featured: typeof FEATURED_AUTHORS[0]; stat: AuthorStat }>;
  }, [allStats]);

  const filtered = useMemo(() => {
    const min = 5; // only authors with 5+ papers
    let result = allStats.filter(a => a.paperCount >= min);
    if (query) {
      const q = query.toLowerCase();
      result = result.filter(a => a.name.toLowerCase().includes(q));
    }
    return result;
  }, [allStats, query]);

  // ── Author detail ──
  if (selectedAuthor) {
    const authorPapers = selectedAuthor.papers.slice().sort((a, b) => b.digestDate.getTime() - a.digestDate.getTime());
    return (
      <div className="max-w-5xl mx-auto px-8 py-6 fade-in">
        <button
          onClick={() => setSelectedAuthor(null)}
          className="text-xs text-slate-500 hover:text-slate-700 mb-4 flex items-center gap-1 transition-colors"
        >
          <ChevronRight size={12} className="rotate-180" /> All authors
        </button>
        <div className="flex items-start gap-4 mb-6">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-lg font-bold shrink-0 shadow-md">
            {selectedAuthor.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">{selectedAuthor.name}</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {selectedAuthor.paperCount} papers · {selectedAuthor.categories.length} categories · last seen {format(selectedAuthor.lastDate, 'MMM yyyy')}
            </p>
            <div className="flex flex-wrap gap-1 mt-2">
              {selectedAuthor.categories.slice(0, 8).map(cat => {
                const color = CATEGORY_COLORS_LIGHT[cat] ?? CATEGORY_COLORS_LIGHT.default;
                return <span key={cat} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${color}`}>{cat}</span>;
              })}
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {authorPapers.map(paper => {
            const assessment = computeAssessment(paper);
            return (
              <button
                key={paper.id}
                onClick={() => setSelectedPaper(paper)}
                className={`w-full text-left px-5 py-3.5 flex items-start gap-4 hover:bg-slate-50 transition-colors group border-b border-slate-100 last:border-0`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 line-clamp-1 group-hover:text-blue-700 transition-colors">{paper.title}</p>
                  <p className="text-xs text-slate-400 mt-1 truncate">
                    {format(paper.digestDate, 'MMM d, yyyy')} · {paper.arxivId}
                  </p>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-1 rounded-full border shrink-0 ${ASSESSMENT_BADGE[assessment.label]}`}>
                  {assessment.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Author list ──
  return (
    <div className="max-w-5xl mx-auto px-8 py-6 fade-in">
      {/* Featured AI researchers */}
      {featuredFound.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Award size={16} className="text-amber-500" />
            <h2 className="text-sm font-bold text-slate-700">Featured Researchers in Your Library</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {featuredFound.map(({ featured, stat }) => (
              <button
                key={featured.name}
                onClick={() => setSelectedAuthor(stat)}
                className="text-left bg-white rounded-xl border border-slate-200 p-4 hover:border-indigo-300 hover:shadow-md transition-all group"
              >
                <div className="flex items-start gap-3 mb-3">
                  <img
                    src={featured.photoUrl}
                    alt={featured.name}
                    className="w-12 h-12 rounded-full object-cover shrink-0 border border-slate-200"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 group-hover:text-indigo-700 transition-colors truncate">{featured.name}</p>
                    <p className="text-[10px] text-slate-400 truncate">{featured.affiliation}</p>
                  </div>
                </div>
                <p className="text-[10px] font-semibold text-indigo-600 mb-1">{featured.title}</p>
                <p className="text-[11px] text-slate-500 line-clamp-3 leading-relaxed">{featured.bio}</p>
                <p className="text-[10px] text-slate-400 mt-2 pt-2 border-t border-slate-100">
                  {stat.paperCount} papers in your library →
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* All authors header */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500">
          {filtered.length} author{filtered.length !== 1 ? 's' : ''} with 5+ papers
        </p>
        <div className="relative w-64">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search authors…"
            className="w-full pl-3 pr-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-all"
          />
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="text-center text-slate-400 text-sm py-12">
          {allStats.length === 0 ? 'No authors found.' : 'No authors with 5+ papers yet.'}
        </p>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <AuthorList items={filtered} onSelect={setSelectedAuthor} />
        </div>
      )}
    </div>
  );
}

// Author list with pagination — keeps the DOM light even with 10k+ authors
function AuthorList({ items, onSelect }: {
  items: AuthorStat[];
  onSelect: (a: AuthorStat) => void;
}) {
  const pager = usePagination(items, 50);
  return (
    <>
      {pager.slice.map((author, idx) => {
        const rank = pager.rangeStart + idx;
        return (
          <button
            key={author.name}
            onClick={() => onSelect(author)}
            className={`w-full text-left px-5 py-3.5 flex items-center gap-4 hover:bg-slate-50 transition-colors group border-b border-slate-100 last:border-0`}
          >
            {/* Rank */}
            <span className="text-[10px] font-bold text-slate-400 w-6 shrink-0 text-right">{rank}</span>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0 ${
              rank <= 3 ? 'bg-gradient-to-br from-indigo-500 to-violet-500' : 'bg-slate-400'
            }`}>
              {author.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800 group-hover:text-indigo-700 transition-colors truncate">{author.name}</p>
              <p className="text-xs text-slate-400 truncate">
                {author.paperCount} papers · {author.categories.slice(0, 3).join(', ')}
                {author.categories.length > 3 && ` +${author.categories.length - 3}`}
              </p>
            </div>
            <span className="text-xs font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded-full shrink-0">
              {author.paperCount}
            </span>
            <ChevronRight size={14} className="text-slate-300 group-hover:text-indigo-500 transition-colors shrink-0" />
          </button>
        );
      })}
      <Pager pagination={pager} variant="light" size="sm" label="authors" pageSizes={[25, 50, 100, 250]} />
    </>
  );
}

// =========================================================================
// Conferences tab — venue list with descriptions + pagination, papers
// inside each venue sortable by year with ranking
// =========================================================================

type ConfSortMode = 'papers' | 'name' | 'recent';

function ConferencesTab({ papers, setSelectedPaper }: {
  papers: ReturnType<typeof usePapers>['papers'];
  setSelectedPaper: (p: ReturnType<typeof usePapers>['papers'][0]) => void;
}) {
  const [selectedVenue, setSelectedVenue] = useState<VenueGroup | null>(null);
  const [sortMode, setSortMode] = useState<ConfSortMode>('papers');

  const allGroups = useMemo(() => groupByVenue(papers), [papers]);
  const allVenuePapers = useMemo(() => papers.filter(p => detectVenue(p) !== null), [papers]);

  const sortedGroups = useMemo(() => {
    const result = [...allGroups];
    if (sortMode === 'papers') {
      result.sort((a, b) => b.papers.length - a.papers.length || a.info.name.localeCompare(b.info.name));
    } else if (sortMode === 'name') {
      result.sort((a, b) => a.info.name.localeCompare(b.info.name));
    } else {
      // recent: most recent paper date first
      result.sort((a, b) => {
        const aLast = Math.max(...a.papers.map(p => p.digestDate.getTime()));
        const bLast = Math.max(...b.papers.map(p => p.digestDate.getTime()));
        return bLast - aLast;
      });
    }
    return result;
  }, [allGroups, sortMode]);

  // ── Venue detail ──
  if (selectedVenue) {
    return (
      <VenueDetail venue={selectedVenue} setSelectedPaper={setSelectedPaper} onBack={() => setSelectedVenue(null)} />
    );
  }

  // ── Venue list ──
  return (
    <div className="max-w-5xl mx-auto px-8 py-6 fade-in">
      {/* Intro */}
      <div className="mb-6">
        <p className="text-sm text-slate-600 leading-relaxed">
          Conference and venue information is automatically detected from the arXiv <code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded">comments</code> field
          of each paper — for example "Accepted at NeurIPS 2024" or "Published in CVPR 2024".
          Papers without venue metadata won't appear here.
        </p>
        <p className="text-sm text-slate-500 mt-2">
          {allVenuePapers.length.toLocaleString()} of {papers.length.toLocaleString()} papers have a detected venue · {allGroups.length} venue{allGroups.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Sort bar */}
      <div className="flex items-center gap-2 mb-4">
        <ArrowUpDown size={13} className="text-slate-400" />
        <span className="text-xs text-slate-500 mr-1">Sort:</span>
        {([
          { value: 'papers', label: 'Most papers' },
          { value: 'name',   label: 'A-Z' },
          { value: 'recent', label: 'Most recent' },
        ] as const).map(opt => (
          <button
            key={opt.value}
            onClick={() => setSortMode(opt.value)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
              sortMode === opt.value
                ? 'bg-slate-800 text-white'
                : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300 hover:text-slate-700'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {allGroups.length === 0 ? (
        <div className="text-center py-12">
          <Presentation size={32} className="mx-auto text-slate-300 mb-3" />
          <p className="text-slate-400 text-sm">
            No conference papers detected. Venue info is parsed from the arXiv "comments" field.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <VenueList items={sortedGroups} onSelect={setSelectedVenue} />
        </div>
      )}
    </div>
  );
}

// Venue list with pagination
function VenueList({ items, onSelect }: {
  items: VenueGroup[];
  onSelect: (v: VenueGroup) => void;
}) {
  const pager = usePagination(items, 20);
  return (
    <>
      {pager.slice.map((group, idx) => {
        const rank = pager.rangeStart + idx;
        const recentPaper = group.papers.slice().sort((a, b) => b.digestDate.getTime() - a.digestDate.getTime())[0];
        return (
          <button
            key={group.info.key}
            onClick={() => onSelect(group)}
            className={`w-full text-left px-5 py-4 flex items-start gap-4 hover:bg-slate-50 transition-colors group border-b border-slate-100 last:border-0`}
          >
            {/* Rank */}
            <span className="text-[10px] font-bold text-slate-400 w-6 shrink-0 text-right mt-1">{rank}</span>
            {/* Icon */}
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0 shadow-sm mt-0.5 ${
              group.info.type === 'conference' ? 'bg-gradient-to-br from-emerald-500 to-teal-500' :
              group.info.type === 'workshop'   ? 'bg-gradient-to-br from-amber-500 to-orange-500' :
                                                  'bg-gradient-to-br from-blue-500 to-cyan-500'
            }`}>
              {group.info.type === 'conference' ? <Presentation size={16} /> :
               group.info.type === 'workshop'   ? <Users size={16} /> :
                                                   <BookOpen size={16} />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-800 group-hover:text-emerald-700 transition-colors">{group.info.name}</p>
                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                  group.info.type === 'conference' ? 'bg-emerald-100 text-emerald-700' :
                  group.info.type === 'workshop'   ? 'bg-amber-100 text-amber-700' :
                                                      'bg-blue-100 text-blue-700'
                }`}>
                  {group.info.type}
                </span>
              </div>
              {/* Description */}
              <p className="text-[11px] text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                {group.info.about}
              </p>
              <p className="text-xs text-slate-400 mt-1.5">
                {group.papers.length} paper{group.papers.length !== 1 ? 's' : ''}
                {group.years.length > 0 && ` · ${group.years.join(', ')}`}
                {recentPaper && ` · latest ${format(recentPaper.digestDate, 'MMM yyyy')}`}
              </p>
            </div>
            <span className="text-xs font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded-full shrink-0 mt-1">
              {group.papers.length}
            </span>
            <ChevronRight size={14} className="text-slate-300 group-hover:text-emerald-500 transition-colors shrink-0 mt-1.5" />
          </button>
        );
      })}
      <Pager pagination={pager} variant="light" size="sm" label="venues" pageSizes={[10, 20, 50]} />
    </>
  );
}

// Venue detail — papers grouped by year with per-year rankings
function VenueDetail({ venue, setSelectedPaper, onBack }: {
  venue: VenueGroup;
  setSelectedPaper: (p: Paper) => void;
  onBack: () => void;
}) {
  const [yearFilter, setYearFilter] = useState<number | 'all'>('all');

  // Group papers by year (extracted from venue detection), sort years desc
  const byYear = useMemo(() => {
    const map = new Map<number, Paper[]>();
    const noYear: Paper[] = [];
    for (const p of venue.papers) {
      const info = detectVenue(p);
      const yr = info?.year;
      if (yr) {
        const arr = map.get(yr) ?? [];
        arr.push(p);
        map.set(yr, arr);
      } else {
        noYear.push(p);
      }
    }
    // Sort each year's papers by assessment score (depth ranking)
    const sortPapers = (arr: Paper[]) =>
      arr.map(p => ({ p, a: computeAssessment(p) }))
         .sort((x, y) => y.a.score - x.a.score)
         .map(x => x.p);
    const grouped = Array.from(map.entries())
      .map(([year, papers]) => ({ year, papers: sortPapers(papers) }))
      .sort((a, b) => b.year - a.year);
    return { grouped, noYear: sortPapers(noYear) };
  }, [venue]);

  // Years available for the filter dropdown
  const years = byYear.grouped.map(g => g.year);

  // Filtered groups
  const visibleGroups = yearFilter === 'all'
    ? byYear.grouped
    : byYear.grouped.filter(g => g.year === yearFilter);

  return (
    <div className="max-w-5xl mx-auto px-8 py-6 fade-in">
      <button
        onClick={onBack}
        className="text-xs text-slate-500 hover:text-slate-700 mb-4 flex items-center gap-1 transition-colors"
      >
        <ChevronRight size={12} className="rotate-180" /> All venues
      </button>
      {/* Venue header */}
      <div className="flex items-start gap-4 mb-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white shrink-0 shadow-md ${
          venue.info.type === 'conference' ? 'bg-gradient-to-br from-emerald-500 to-teal-500' :
          venue.info.type === 'workshop'   ? 'bg-gradient-to-br from-amber-500 to-orange-500' :
                                              'bg-gradient-to-br from-blue-500 to-cyan-500'
        }`}>
          {venue.info.type === 'conference' ? <Presentation size={20} /> :
           venue.info.type === 'workshop'   ? <Users size={20} /> :
                                               <BookOpen size={20} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900">{venue.info.name}</h2>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              venue.info.type === 'conference' ? 'bg-emerald-100 text-emerald-700' :
              venue.info.type === 'workshop'   ? 'bg-amber-100 text-amber-700' :
                                                  'bg-blue-100 text-blue-700'
            }`}>
              {venue.info.type}
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-0.5 leading-relaxed">{venue.info.about}</p>
          <p className="text-xs text-slate-400 mt-1">
            {venue.papers.length} paper{venue.papers.length !== 1 ? 's' : ''} across {years.length} year{years.length !== 1 ? 's' : ''}
            {years.length > 0 && ` · ${years.join(', ')}`}
          </p>
        </div>
      </div>

      {/* Year filter bar */}
      {years.length > 1 && (
        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1 hide-scrollbar">
          <button
            onClick={() => setYearFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
              yearFilter === 'all'
                ? 'bg-slate-800 text-white'
                : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300 hover:text-slate-700'
            }`}
          >
            All years
            <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
              yearFilter === 'all' ? 'bg-white/20' : 'bg-slate-100'
            }`}>
              {venue.papers.length}
            </span>
          </button>
          {years.map(yr => {
            const count = byYear.grouped.find(g => g.year === yr)?.papers.length ?? 0;
            const active = yearFilter === yr;
            return (
              <button
                key={yr}
                onClick={() => setYearFilter(yr)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  active
                    ? 'bg-slate-800 text-white'
                    : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300 hover:text-slate-700'
                }`}
              >
                {yr}
                <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                  active ? 'bg-white/20' : 'bg-slate-100'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Papers grouped by year with per-year ranking */}
      <div className="space-y-8">
        {visibleGroups.map(group => (
          <YearSection
            key={group.year}
            year={group.year}
            papers={group.papers}
            setSelectedPaper={setSelectedPaper}
          />
        ))}
        {/* Papers with no detected year (only in "all" mode) */}
        {yearFilter === 'all' && byYear.noYear.length > 0 && (
          <YearSection
            year={null}
            papers={byYear.noYear}
            setSelectedPaper={setSelectedPaper}
          />
        )}
        {visibleGroups.length === 0 && byYear.noYear.length === 0 && (
          <p className="text-center text-slate-400 text-sm py-8">No papers for this year.</p>
        )}
      </div>
    </div>
  );
}

// A single year section within a venue detail — papers ranked by depth score
function YearSection({ year, papers, setSelectedPaper }: {
  year: number | null;
  papers: Paper[];
  setSelectedPaper: (p: Paper) => void;
}) {
  const pager = usePagination(papers, 50);
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <div className={`px-3 py-1 rounded-lg text-sm font-bold ${
          year ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-600'
        }`}>
          {year ?? 'Date unknown'}
        </div>
        <span className="text-xs text-slate-400">
          {papers.length} paper{papers.length !== 1 ? 's' : ''} · ranked by depth score
        </span>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {pager.slice.map((paper, idx) => {
          const assessment = computeAssessment(paper);
          const rank = idx + 1; // per-year rank
          return (
            <button
              key={paper.id}
              onClick={() => setSelectedPaper(paper)}
              className={`w-full text-left px-5 py-3.5 flex items-start gap-4 hover:bg-slate-50 transition-colors group border-b border-slate-100 last:border-0`}
            >
              {/* Per-year rank badge */}
              <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 font-bold text-xs ${
                rank === 1 ? 'bg-amber-100 text-amber-700' :
                rank === 2 ? 'bg-slate-100 text-slate-600' :
                rank === 3 ? 'bg-orange-100 text-orange-700' :
                'bg-slate-50 text-slate-400'
              }`}>
                {rank}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 line-clamp-1 group-hover:text-blue-700 transition-colors">{paper.title}</p>
                <p className="text-xs text-slate-400 mt-1 truncate">
                  {paper.authorList[0]}{paper.authorList.length > 1 ? ' et al.' : ''} · {format(paper.digestDate, 'MMM d, yyyy')}
                </p>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-1 rounded-full border shrink-0 ${ASSESSMENT_BADGE[assessment.label]}`}>
                {assessment.label}
              </span>
            </button>
          );
        })}
        <Pager pagination={pager} variant="light" size="sm" label="papers" pageSizes={[25, 50, 100]} />
      </div>
    </section>
  );
}