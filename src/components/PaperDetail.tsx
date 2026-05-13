import { ExternalLink, FileText, Code2, Calendar, HardDrive, MessageSquare, Bookmark, BookmarkCheck, Users, BarChart2, Layers, Quote, BookOpen, Check, Sparkles, ChevronUp } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { Paper } from '../types';
import { CATEGORY_COLORS_LIGHT, getCategoryLabel, CATEGORY_COLORS } from '../utils/categories';
import { renderAbstract } from '../utils/latex';
import { computeAssessment, ASSESSMENT_BADGE, ASSESSMENT_BAR } from '../utils/assessment';
import { getRelatedPapers } from '../utils/related';
import { fetchCitationCounts } from '../utils/citations';
import { useLibrary } from '../contexts/LibraryContext';
import { usePapers } from '../contexts/PapersContext';
import { format } from 'date-fns';

interface Props {
  paper: Paper;
}

export default function PaperDetail({ paper }: Props) {
  const { papers, setSelectedPaper, updatePaperAbstract } = usePapers();
  const [citationCount, setCitationCount] = useState<number | null>(null);
  const [fetchedAbstract, setFetchedAbstract] = useState<string | null>(null);
  const [abstractLoading, setAbstractLoading] = useState(false);

  useEffect(() => {
    setCitationCount(null);
    fetchCitationCounts([paper.arxivId]).then(data => {
      const c = data[paper.arxivId];
      if (c !== undefined) setCitationCount(c);
    });
  }, [paper.arxivId]);

  // Auto-fetch abstract from arXiv API when digest email didn't include it, then persist it
  useEffect(() => {
    setFetchedAbstract(null);
    if (paper.abstract) return;
    setAbstractLoading(true);
    fetch(`/api/arxiv-abstract?id=${encodeURIComponent(paper.arxivId)}`)
      .then(r => r.text())
      .then(xml => {
        // Parse as XML — arXiv responses use the Atom default namespace, so we use
        // getElementsByTagNameNS('*', ...) to match by local name regardless of NS.
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        // Bail if the parse produced a <parsererror> element
        if (doc.getElementsByTagName('parsererror').length > 0) return;
        const entries  = doc.getElementsByTagNameNS('*', 'entry');
        const entry    = entries.item(0);
        if (!entry) return;
        const summary  = entry.getElementsByTagNameNS('*', 'summary').item(0);
        const text     = summary?.textContent?.trim().replace(/\s+/g, ' ') ?? '';
        if (text) {
          setFetchedAbstract(text);
          updatePaperAbstract(paper.id, text);
        }
      })
      .catch(() => {})
      .finally(() => setAbstractLoading(false));
  }, [paper.arxivId, paper.abstract, paper.id, updatePaperAbstract]);

  const { savePaper, unsavePaper, isSaved } = useLibrary();
  const saved = isSaved(paper.id);
  const [notebookCopied, setNotebookCopied] = useState(false);

  // AI Summary
  const [summaryOpen,    setSummaryOpen]    = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError,   setSummaryError]   = useState<string | null>(null);
  const [summary,        setSummary]        = useState<{
    tldr: string;
    contributions: string[];
    methodology: string;
    results: string;
    impact: string;
  } | null>(null);

  const { settings } = usePapers();
  const displayAbstract = paper.abstract || fetchedAbstract || '';

  // Reset summary when switching papers
  useEffect(() => {
    setSummary(null);
    setSummaryOpen(false);
    setSummaryError(null);
  }, [paper.id]);

  const handleSummarize = useCallback(async () => {
    if (!settings.claudeApiKey) return;
    if (summary) { setSummaryOpen(v => !v); return; }
    setSummaryOpen(true);
    setSummaryLoading(true);
    setSummaryError(null);

    const abstract = (paper.abstract || fetchedAbstract || '') || 'Abstract not available.';
    const prompt = `You are a research paper assistant. Summarize this paper concisely and return ONLY a JSON object.

Title: ${paper.title}
Authors: ${paper.authors}
Abstract: ${abstract}

Return exactly this JSON structure (no other text):
{
  "tldr": "1-2 sentence plain-English summary for a non-specialist",
  "contributions": ["key contribution 1", "key contribution 2", "key contribution 3"],
  "methodology": "brief description of methods/approach used",
  "results": "main findings or outcomes",
  "impact": "why this matters and potential applications"
}`;

    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': settings.claudeApiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 800,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(25000),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(err.error?.message ?? `API error ${resp.status}`);
      }

      const data = await resp.json() as { content: Array<{ text: string }> };
      const text = data.content[0]?.text ?? '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Could not parse response');
      setSummary(JSON.parse(jsonMatch[0]));
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setSummaryLoading(false);
    }
  }, [settings.claudeApiKey, summary, paper.title, paper.authors, paper.abstract, fetchedAbstract]);

  const openNotebookLM = useCallback(() => {
    navigator.clipboard.writeText(paper.pdfUrl).catch(() => {});
    setNotebookCopied(true);
    setTimeout(() => setNotebookCopied(false), 2500);
    window.open('https://notebooklm.google.com', '_blank', 'noopener,noreferrer');
  }, [paper.pdfUrl]);

  const abstractHtml = renderAbstract(displayAbstract);
  const assessment   = computeAssessment(paper);
  const related      = getRelatedPapers(paper, papers, 6);

  return (
    <div className="h-full overflow-y-auto main-scroll">
      <div className="max-w-3xl mx-auto px-8 py-10 fade-in">
        {/* Categories */}
        <div className="flex flex-wrap gap-2 mb-5">
          {paper.categories.map(cat => {
            const color = CATEGORY_COLORS_LIGHT[cat] ?? CATEGORY_COLORS_LIGHT.default;
            return (
              <span key={cat} className={`text-xs font-semibold px-2.5 py-1 rounded-full ${color}`} title={getCategoryLabel(cat)}>
                {cat} · {getCategoryLabel(cat)}
              </span>
            );
          })}
        </div>

        {/* Title + save button */}
        <div className="flex items-start gap-3 mb-4">
          <h1 className="text-2xl font-bold text-slate-900 leading-tight flex-1">
            {paper.title}
          </h1>
          <button
            onClick={() => saved ? unsavePaper(paper.id) : savePaper(paper)}
            title={saved ? 'Remove from library' : 'Save to library'}
            className={`shrink-0 mt-1 p-2 rounded-lg border transition-all ${
              saved
                ? 'bg-amber-50 border-amber-200 text-amber-600 hover:bg-amber-100'
                : 'bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100 hover:text-amber-500'
            }`}
          >
            {saved ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
          </button>
        </div>

        {/* Authors */}
        <p className="text-base text-slate-600 mb-5 leading-relaxed">
          {paper.authors}
        </p>

        {/* Meta row */}
        <div className="flex flex-wrap gap-4 text-sm text-slate-500 mb-7 pb-6 border-b border-slate-200">
          <span className="flex items-center gap-1.5">
            <Calendar size={14} />
            {paper.date || format(paper.digestDate, 'PPP')}
          </span>
          <span className="flex items-center gap-1.5">
            <HardDrive size={14} />
            arXiv:{paper.arxivId}
            {paper.size && ` · ${paper.size}`}
          </span>
          <span className="flex items-center gap-1.5">
            <Users size={14} />
            {paper.authorList.length} author{paper.authorList.length !== 1 ? 's' : ''}
          </span>
          {paper.comments && (
            <span className="flex items-center gap-1.5">
              <MessageSquare size={14} />
              {paper.comments}
            </span>
          )}
          {citationCount !== null && (
            <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
              <Quote size={14} />
              {citationCount.toLocaleString()} citation{citationCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Assessment panel */}
        <div className="mb-8 rounded-xl border border-slate-200 bg-slate-50 p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 size={15} className="text-slate-500" />
            <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Assessment</h2>
            <span className={`ml-auto text-xs font-semibold px-2.5 py-1 rounded-full border ${ASSESSMENT_BADGE[assessment.label]}`}>
              {assessment.label}
            </span>
          </div>

          {/* Score bar */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-slate-500">Depth score</span>
              <span className="text-xs font-bold text-slate-700">{assessment.score}/100</span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${ASSESSMENT_BAR[assessment.label]}`}
                style={{ width: `${assessment.score}%` }}
              />
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-white rounded-lg border border-slate-200 px-3 py-2 text-center">
              <p className="text-base font-bold text-slate-800">{assessment.wordCount}</p>
              <p className="text-[10px] text-slate-500">abstract words</p>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 px-3 py-2 text-center">
              <p className="text-base font-bold text-slate-800">{paper.authorList.length}</p>
              <p className="text-[10px] text-slate-500">authors</p>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 px-3 py-2 text-center">
              <p className="text-base font-bold text-slate-800">{paper.categories.length}</p>
              <p className="text-[10px] text-slate-500">categories</p>
            </div>
          </div>

          {/* Signals */}
          {assessment.signals.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Research signals</p>
              <div className="flex flex-wrap gap-1.5">
                {assessment.signals.map(s => (
                  <span key={s} className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Abstract */}
        <div className="mb-8">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Abstract</h2>
          {abstractLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <svg className="animate-spin w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Fetching abstract from arXiv…
            </div>
          ) : (
            <div
              className="abstract-text text-slate-700 leading-relaxed text-[15px] space-y-3"
              dangerouslySetInnerHTML={{ __html: abstractHtml }}
            />
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3 mb-10 pb-8 border-b border-slate-200">
          <a
            href={paper.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm shadow-blue-600/20"
          >
            <ExternalLink size={15} />
            View on arXiv
          </a>
          <a
            href={paper.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-5 py-2.5 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-700 transition-colors"
          >
            <FileText size={15} />
            Download PDF
          </a>
          <a
            href={`https://arxiv.org/html/${paper.arxivId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-5 py-2.5 border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
          >
            <Code2 size={15} />
            HTML Version
          </a>
          <a
            href={`https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-5 py-2.5 border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
          >
            <Layers size={15} />
            Google Scholar
          </a>
          <button
            onClick={openNotebookLM}
            title="Copy PDF URL and open NotebookLM"
            className={`flex items-center gap-2 px-5 py-2.5 border text-sm font-medium rounded-lg transition-all ${
              notebookCopied
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                : 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100'
            }`}
          >
            {notebookCopied ? <Check size={15} /> : <BookOpen size={15} />}
            {notebookCopied ? 'PDF URL copied!' : 'Open in NotebookLM'}
          </button>
          <button
            onClick={handleSummarize}
            disabled={summaryLoading || !settings.claudeApiKey}
            title={!settings.claudeApiKey ? 'Add a Claude API key in Settings to use AI summaries' : 'Summarize with Claude AI'}
            className={`flex items-center gap-2 px-5 py-2.5 border text-sm font-medium rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
              summary && summaryOpen
                ? 'border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100'
                : 'border-purple-200 bg-white text-purple-700 hover:bg-purple-50'
            }`}
          >
            {summaryLoading ? (
              <svg className="animate-spin w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            ) : summary && summaryOpen ? (
              <ChevronUp size={15} />
            ) : (
              <Sparkles size={15} />
            )}
            {summaryLoading ? 'Summarizing…' : summary ? (summaryOpen ? 'Hide Summary' : 'Show Summary') : 'Summarize'}
          </button>
        </div>

        {/* AI Summary panel */}
        {summaryOpen && (
          <div className="mb-8 rounded-xl border border-purple-200 bg-purple-50/40 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-purple-500" />
              <h2 className="text-xs font-semibold uppercase tracking-widest text-purple-600">AI Summary</h2>
            </div>
            {summaryLoading && (
              <div className="flex items-center gap-2 text-sm text-purple-500">
                <svg className="animate-spin w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Generating summary…
              </div>
            )}
            {summaryError && (
              <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{summaryError}</p>
            )}
            {summary && (
              <div className="space-y-4">
                {/* TL;DR */}
                <div className="bg-white rounded-lg border border-purple-200 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-purple-400 mb-1.5">TL;DR</p>
                  <p className="text-sm text-slate-700 leading-relaxed">{summary.tldr}</p>
                </div>
                {/* Contributions */}
                {summary.contributions?.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-purple-400 mb-2">Key Contributions</p>
                    <ul className="space-y-1.5">
                      {summary.contributions.map((c, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                          <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {/* Methodology + Results grid */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {summary.methodology && (
                    <div className="bg-white rounded-lg border border-purple-200 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-purple-400 mb-1">Methodology</p>
                      <p className="text-sm text-slate-700 leading-relaxed">{summary.methodology}</p>
                    </div>
                  )}
                  {summary.results && (
                    <div className="bg-white rounded-lg border border-purple-200 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-purple-400 mb-1">Results</p>
                      <p className="text-sm text-slate-700 leading-relaxed">{summary.results}</p>
                    </div>
                  )}
                </div>
                {/* Impact */}
                {summary.impact && (
                  <div className="bg-purple-100/60 rounded-lg border border-purple-200 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-purple-400 mb-1">Impact & Applications</p>
                    <p className="text-sm text-slate-700 leading-relaxed">{summary.impact}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Related papers */}
        {related.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">Related Papers</h2>
            <div className="space-y-3">
              {related.map(({ paper: rp, reasons }) => {
                const rAssessment = computeAssessment(rp);
                return (
                  <button
                    key={rp.id}
                    onClick={() => setSelectedPaper(rp)}
                    className="w-full text-left rounded-xl border border-slate-200 bg-white p-4 hover:border-blue-300 hover:shadow-sm transition-all group"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        {/* Categories */}
                        <div className="flex flex-wrap gap-1 mb-2">
                          {rp.categories.slice(0, 3).map(cat => {
                            const color = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.default;
                            return (
                              <span key={cat} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${color}`}>
                                {cat}
                              </span>
                            );
                          })}
                        </div>
                        <p className="text-sm font-medium text-slate-800 leading-snug line-clamp-2 group-hover:text-blue-700 transition-colors">
                          {rp.title}
                        </p>
                        <p className="text-xs text-slate-400 mt-1 truncate">
                          {rp.authorList[0]}{rp.authorList.length > 1 ? ' et al.' : ''} · {format(rp.digestDate, 'MMM d, yyyy')}
                        </p>
                        {/* Reasons */}
                        <div className="flex flex-wrap gap-1 mt-2">
                          {reasons.map(r => (
                            <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                              {r}
                            </span>
                          ))}
                        </div>
                      </div>
                      <span className={`shrink-0 text-[10px] font-semibold px-2 py-1 rounded-full border mt-0.5 ${ASSESSMENT_BADGE[rAssessment.label]}`}>
                        {rAssessment.label}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {related.length === 0 && (
          <div className="text-center py-6 text-slate-400 text-sm">
            No related papers found in your current inbox.
          </div>
        )}
      </div>
    </div>
  );
}
