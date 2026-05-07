import { usePapers } from '../contexts/PapersContext';
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend,
} from 'recharts';
import { CHART_COLORS, getCategoryLabel } from '../utils/categories';
import { format, startOfWeek, eachWeekOfInterval, min, max } from 'date-fns';
import { BookOpen, Layers, Tag, CalendarDays } from 'lucide-react';

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: React.ElementType; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm flex items-center gap-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
        <Icon size={20} className="text-white" />
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-800">{value}</p>
        <p className="text-xs text-slate-500 mt-0.5">{label}</p>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { papers, setSelectedPaper } = usePapers();

  if (papers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
          <BookOpen size={28} className="text-slate-400" />
        </div>
        <h2 className="text-xl font-semibold text-slate-700 mb-2">No papers yet</h2>
        <p className="text-slate-400 text-sm max-w-sm">
          Connect your Gmail and sync to load arXiv digest emails. Papers will appear here.
        </p>
      </div>
    );
  }

  // Stats
  const digestIds = new Set(papers.map(p => p.emailId));
  const allCats = papers.flatMap(p => p.categories);
  const uniqueCats = new Set(allCats);
  const dates = papers.map(p => p.digestDate);
  const earliest = min(dates);
  const latest = max(dates);

  // Category distribution
  const catCounts: Record<string, number> = {};
  for (const cat of allCats) catCounts[cat] = (catCounts[cat] ?? 0) + 1;
  const catData = Object.entries(catCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([cat, count]) => ({ cat, count, label: getCategoryLabel(cat) }));

  // Papers per week timeline
  let weekData: Array<{ week: string; papers: number }> = [];
  if (dates.length > 0) {
    const weeks = eachWeekOfInterval({ start: earliest, end: latest });
    weekData = weeks.map(w => {
      const weekStart = startOfWeek(w);
      const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      const count = papers.filter(p => p.digestDate >= weekStart && p.digestDate < weekEnd).length;
      return { week: format(w, 'MMM d'), papers: count };
    }).filter(d => d.papers > 0);
  }

  // Recent papers
  const recent = papers.slice(0, 5);

  return (
    <div className="h-full overflow-y-auto main-scroll">
      <div className="max-w-5xl mx-auto px-8 py-8 fade-in">
        <div className="mb-7">
          <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">Overview of your arXiv paper digests</p>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard label="Total Papers" value={papers.length} icon={BookOpen} color="bg-blue-500" />
          <StatCard label="Digest Emails" value={digestIds.size} icon={Layers} color="bg-violet-500" />
          <StatCard label="Categories" value={uniqueCats.size} icon={Tag} color="bg-emerald-500" />
          <StatCard
            label="Date Range"
            value={dates.length > 1 ? `${format(earliest, 'MMM yy')} – ${format(latest, 'MMM yy')}` : format(earliest, 'MMM yyyy')}
            icon={CalendarDays}
            color="bg-orange-500"
          />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-8">
          {/* Category chart */}
          <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Papers by Category</h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={catData} layout="vertical" margin={{ left: 8, right: 8 }}>
                <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis
                  dataKey="cat"
                  type="category"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  width={60}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(value, _name, props) => [value, props.payload.label]}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {catData.map((_, index) => (
                    <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Timeline chart */}
          {weekData.length > 1 && (
            <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-700 mb-4">Papers Over Time</h2>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={weekData} margin={{ left: 0, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="papers" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="Papers" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Recent papers */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700">Recent Papers</h2>
          </div>
          <ul>
            {recent.map((paper, idx) => (
              <li key={paper.id}>
                <button
                  onClick={() => setSelectedPaper(paper)}
                  className={`w-full text-left px-5 py-3.5 hover:bg-slate-50 transition-colors flex items-start gap-3 ${idx < recent.length - 1 ? 'border-b border-slate-100' : ''}`}
                >
                  <span className="text-xs font-bold text-slate-300 mt-0.5 w-5 shrink-0">{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 leading-snug line-clamp-1">{paper.title}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {paper.authorList[0]}{paper.authorList.length > 1 ? ' et al.' : ''} · {format(paper.digestDate, 'MMM d, yyyy')}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {paper.categories.slice(0, 2).map(cat => (
                      <span key={cat} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                        {cat}
                      </span>
                    ))}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
