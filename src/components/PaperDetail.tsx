import { ExternalLink, FileText, Code2, Calendar, HardDrive, MessageSquare } from 'lucide-react';
import { Paper } from '../types';
import { CATEGORY_COLORS_LIGHT, getCategoryLabel } from '../utils/categories';
import { renderAbstract } from '../utils/latex';
import { format } from 'date-fns';

interface Props {
  paper: Paper;
}

export default function PaperDetail({ paper }: Props) {
  const abstractHtml = renderAbstract(paper.abstract);

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

        {/* Title */}
        <h1 className="text-2xl font-bold text-slate-900 leading-tight mb-4">
          {paper.title}
        </h1>

        {/* Authors */}
        <p className="text-base text-slate-600 mb-5 leading-relaxed">
          {paper.authors}
        </p>

        {/* Meta row */}
        <div className="flex flex-wrap gap-4 text-sm text-slate-500 mb-7 pb-6 border-b border-slate-200">
          <span className="flex items-center gap-1.5">
            <Calendar size={14} />
            Submitted: {paper.date || format(paper.digestDate, 'PPP')}
          </span>
          <span className="flex items-center gap-1.5">
            <HardDrive size={14} />
            arXiv:{paper.arxivId}
            {paper.size && ` · ${paper.size}`}
          </span>
          {paper.comments && (
            <span className="flex items-center gap-1.5">
              <MessageSquare size={14} />
              {paper.comments}
            </span>
          )}
        </div>

        {/* Abstract */}
        <div className="mb-8">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Abstract</h2>
          <div
            className="abstract-text text-slate-700 leading-relaxed text-[15px] space-y-3"
            dangerouslySetInnerHTML={{ __html: abstractHtml }}
          />
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3">
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
        </div>
      </div>
    </div>
  );
}
