import { useState } from 'react';
import { X, Sparkles, Search, ExternalLink, Key } from 'lucide-react';
import { usePapers } from '../contexts/PapersContext';
import { computeAssessment, ASSESSMENT_BADGE } from '../utils/assessment';
import { CATEGORY_COLORS } from '../utils/categories';
import { aiChat, hasAI, resolveAIConfig, providerLabel } from '../utils/aiProvider';
import { format } from 'date-fns';
import { Paper } from '../types';

interface Props {
  onClose: () => void;
}

interface SuggestedPaper { paper: Paper; reason: string }
interface Result { papers: SuggestedPaper[]; searches: string[] }

export default function AISuggestPanel({ onClose }: Props) {
  const { papers, settings, setSelectedPaper } = usePapers();
  const [query, setQuery]     = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<Result | null>(null);
  const [error, setError]     = useState<string | null>(null);

  const hasKey  = hasAI(settings);
  const aiLabel = providerLabel(resolveAIConfig(settings));

  async function suggest() {
    if (!query.trim() || !hasKey) return;
    setLoading(true);
    setError(null);
    setResult(null);

    const topPapers = [...papers]
      .sort((a, b) => computeAssessment(b).score - computeAssessment(a).score)
      .slice(0, 40);

    const paperList = topPapers
      .map((p, i) => `[${i}] ID:${p.id}\nTitle: ${p.title}\nAuthors: ${p.authors}\nAbstract: ${p.abstract.slice(0, 250)}`)
      .join('\n\n---\n\n');

    const prompt = `You are a research paper assistant. The user is looking for: "${query}"

Here are papers from their arXiv inbox:

${paperList}

Return a JSON object with exactly this structure:
{
  "papers": [
    {"index": 0, "reason": "one sentence why this matches"}
  ],
  "searches": ["arXiv search query 1", "arXiv search query 2", "arXiv search query 3"]
}

Select up to 5 most relevant papers (by index). "searches" should be 3–5 arXiv search terms the user could use to find more papers on this topic. Return ONLY the JSON, no other text.`;

    try {
      const text = await aiChat(
        [{ role: 'user', content: prompt }],
        settings,
        { maxTokens: 800, temperature: 0.3, timeoutMs: 30_000 },
      );
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Could not parse AI response');

      const parsed = JSON.parse(jsonMatch[0]) as { papers: Array<{ index: number; reason: string }>; searches: string[] };

      const suggested: SuggestedPaper[] = parsed.papers
        .filter(p => p.index >= 0 && p.index < topPapers.length)
        .map(p => ({ paper: topPapers[p.index], reason: p.reason }));

      setResult({ papers: suggested, searches: parsed.searches ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch">
      {/* Backdrop */}
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="w-[480px] bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-violet-50 to-blue-50">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-violet-500" />
            <h2 className="text-base font-semibold text-slate-800">AI Paper Suggestions</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!hasKey ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-center">
              <Key size={28} className="mx-auto text-amber-400 mb-3" />
              <p className="text-sm font-medium text-amber-800 mb-1">AI provider not configured</p>
              <p className="text-xs text-amber-600 leading-relaxed">
                Open <strong>Settings</strong> and pick a provider: Claude, OpenAI, Groq (free tier), or Ollama (runs locally, no key needed).
              </p>
            </div>
          ) : (
            <>
              <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                Describe your research interest and <span className="font-semibold text-slate-700">{aiLabel}</span> will find the most relevant papers from your inbox and suggest arXiv search queries.
              </p>

              <textarea
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) suggest(); }}
                placeholder="e.g. efficient transformers for long sequences, or protein structure prediction using deep learning…"
                rows={3}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400 resize-none transition-all"
              />

              <button
                onClick={suggest}
                disabled={loading || !query.trim()}
                className="w-full mt-3 flex items-center justify-center gap-2 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {loading ? (
                  <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Thinking…</>
                ) : (
                  <><Sparkles size={15} /> Suggest Papers</>
                )}
              </button>
              <p className="text-[10px] text-slate-400 text-center mt-1.5">⌘ Enter to search</p>
            </>
          )}

          {error && (
            <div className="mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs">{error}</div>
          )}

          {result && (
            <div className="mt-6 space-y-5">
              {result.papers.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
                    Relevant papers from your inbox
                  </h3>
                  <div className="space-y-3">
                    {result.papers.map(({ paper, reason }) => {
                      const assessment = computeAssessment(paper);
                      return (
                        <button
                          key={paper.id}
                          onClick={() => { setSelectedPaper(paper); onClose(); }}
                          className="w-full text-left rounded-xl border border-slate-200 bg-slate-50 p-3.5 hover:border-violet-300 hover:bg-violet-50/50 transition-all group"
                        >
                          <div className="flex flex-wrap gap-1 mb-2">
                            {paper.categories.slice(0, 3).map(cat => {
                              const color = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.default;
                              return <span key={cat} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${color}`}>{cat}</span>;
                            })}
                            <span className={`ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${ASSESSMENT_BADGE[assessment.label]}`}>
                              {assessment.label}
                            </span>
                          </div>
                          <p className="text-sm font-medium text-slate-800 leading-snug line-clamp-2 group-hover:text-violet-700 transition-colors">
                            {paper.title}
                          </p>
                          <p className="text-xs text-slate-400 mt-1 truncate">
                            {paper.authorList[0]}{paper.authorList.length > 1 ? ' et al.' : ''} · {format(paper.digestDate, 'MMM d, yyyy')}
                          </p>
                          <p className="text-xs text-violet-600 mt-1.5 italic leading-snug">"{reason}"</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {result.searches.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
                    Suggested arXiv searches
                  </h3>
                  <div className="space-y-2">
                    {result.searches.map(q => (
                      <a
                        key={q}
                        href={`https://arxiv.org/search/?query=${encodeURIComponent(q)}&searchtype=all`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50 transition-all group"
                      >
                        <span className="flex items-center gap-2 text-sm text-slate-700 group-hover:text-blue-700">
                          <Search size={13} className="text-slate-400 group-hover:text-blue-500" />
                          {q}
                        </span>
                        <ExternalLink size={12} className="text-slate-300 group-hover:text-blue-400 shrink-0" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
