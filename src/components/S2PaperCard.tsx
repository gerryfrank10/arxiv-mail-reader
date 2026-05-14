import { ExternalLink, FileText, Quote, Sparkle, Bookmark, BookmarkCheck } from 'lucide-react';
import { S2Paper, Paper } from '../types';
import { s2PaperUrl, s2PdfUrl, authorNames } from '../utils/semanticScholar';
import { useLibrary } from '../contexts/LibraryContext';
import { usePapers } from '../contexts/PapersContext';

interface Props {
  paper: S2Paper;
  compact?: boolean;
  showSave?: boolean;
  highlight?: 'foundational' | 'influential' | 'latest' | 'survey' | null;
}

// Convert an S2Paper into our internal Paper shape so it can be saved /
// loaded in the existing detail viewer when it has an arXiv id.
function toLocalPaper(p: S2Paper): Paper | null {
  const arxivId = p.externalIds?.ArXiv;
  if (!arxivId) return null;
  return {
    id:            `s2-${p.paperId}`,
    arxivId,
    date:          p.year ? String(p.year) : '',
    size:          '',
    title:         p.title,
    authors:       authorNames(p),
    authorList:    (p.authors ?? []).map(a => a.name),
    categories:    [],
    comments:      p.venue ?? '',
    abstract:      p.abstract ?? '',
    url:           `https://arxiv.org/abs/${arxivId}`,
    pdfUrl:        `https://arxiv.org/pdf/${arxivId}`,
    emailId:       '',
    digestSubject: '',
    digestDate:    p.year ? new Date(p.year, 0, 1) : new Date(),
  };
}

export default function S2PaperCard({ paper, compact = false, showSave = true, highlight = null }: Props) {
  const { savePaper, unsavePaper, isSaved } = useLibrary();
  const { setSelectedPaper } = usePapers();
  const local = toLocalPaper(paper);
  const saved = local ? isSaved(local.id) : false;
  const arxiv = paper.externalIds?.ArXiv;
  const url   = s2PaperUrl(paper);
  const pdf   = s2PdfUrl(paper);
  const cites = paper.citationCount ?? 0;
  const infl  = paper.influentialCitationCount ?? 0;

  function open() {
    if (local) setSelectedPaper(local);
    else window.open(url, '_blank', 'noopener,noreferrer');
  }

  function bookmark(e: React.MouseEvent) {
    e.stopPropagation();
    if (!local) return;
    if (saved) unsavePaper(local.id);
    else       savePaper(local);
  }

  return (
    <div
      onClick={open}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') open(); }}
      className="group cursor-pointer bg-white rounded-xl border border-slate-200 hover:border-blue-300 hover:shadow-md transition-all p-4"
    >
      {/* Top row: meta + actions */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 min-w-0">
          {paper.year && <span className="font-medium text-slate-600">{paper.year}</span>}
          {paper.venue && <><span className="text-slate-300">·</span><span className="truncate max-w-[200px]">{paper.venue}</span></>}
          {arxiv && <><span className="text-slate-300">·</span><span className="font-mono text-blue-500">arXiv:{arxiv}</span></>}
          {highlight === 'foundational' && <span className="text-amber-600 font-medium">★ Foundational</span>}
          {highlight === 'influential'  && <span className="text-rose-600 font-medium">🚀 Influential</span>}
          {highlight === 'latest'       && <span className="text-emerald-600 font-medium">New</span>}
          {highlight === 'survey'       && <span className="text-indigo-600 font-medium">📖 Survey</span>}
        </div>
        {showSave && local && (
          <button
            onClick={bookmark}
            title={saved ? 'Remove from library' : 'Save to library'}
            className={`shrink-0 p-1 rounded transition-all opacity-0 group-hover:opacity-100 ${
              saved ? 'opacity-100 text-amber-500 hover:text-amber-600' : 'text-slate-400 hover:text-amber-500'
            }`}
          >
            {saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
          </button>
        )}
      </div>

      {/* Title */}
      <h3 className={`font-semibold text-slate-800 leading-snug ${compact ? 'text-sm line-clamp-2' : 'text-base line-clamp-3'} group-hover:text-blue-700 transition-colors`}>
        {paper.title}
      </h3>

      {/* Authors */}
      <p className="text-xs text-slate-500 mt-1.5 truncate">
        {authorNames(paper) || '—'}
      </p>

      {/* TLDR */}
      {!compact && paper.tldr?.text && (
        <p className="text-xs text-slate-600 mt-2 leading-relaxed line-clamp-2 italic">
          <Sparkle size={10} className="inline -mt-0.5 mr-1 text-violet-400" />
          {paper.tldr.text}
        </p>
      )}

      {/* Bottom row: stats + links */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
        <div className="flex items-center gap-3 text-[11px] text-slate-500">
          <span className="flex items-center gap-1">
            <Quote size={11} />
            <span className="font-medium text-slate-700">{cites.toLocaleString()}</span>
            <span className="text-slate-400">citations</span>
          </span>
          {infl > 0 && (
            <span title="Influential citations (Semantic Scholar)" className="flex items-center gap-1 text-rose-500">
              <Sparkle size={10} />
              {infl}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {pdf && (
            <a
              href={pdf}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              title="Open PDF"
              className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <FileText size={13} />
            </a>
          )}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            title="Open paper page"
            className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <ExternalLink size={13} />
          </a>
        </div>
      </div>
    </div>
  );
}
