import { Paper } from '../types';
import { CATEGORY_COLORS, getCategoryLabel } from '../utils/categories';
import { format } from 'date-fns';

interface Props {
  paper: Paper;
  isSelected: boolean;
  onClick: () => void;
}

export default function PaperCard({ paper, isSelected, onClick }: Props) {
  const firstAuthor = paper.authorList[0] ?? paper.authors;
  const coauthors = paper.authorList.length > 1;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3.5 border-b border-slate-800/60 transition-all group ${
        isSelected
          ? 'bg-blue-600/20 border-l-2 border-l-blue-500'
          : 'hover:bg-slate-800/40 border-l-2 border-l-transparent'
      }`}
    >
      {/* Categories */}
      <div className="flex flex-wrap gap-1 mb-2">
        {paper.categories.slice(0, 3).map(cat => {
          const color = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.default;
          return (
            <span
              key={cat}
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${color}`}
              title={getCategoryLabel(cat)}
            >
              {cat}
            </span>
          );
        })}
        {paper.categories.length > 3 && (
          <span className="text-[10px] text-slate-500">+{paper.categories.length - 3}</span>
        )}
      </div>

      {/* Title */}
      <p className={`text-sm font-medium leading-snug mb-1.5 line-clamp-2 ${isSelected ? 'text-white' : 'text-slate-200 group-hover:text-white'}`}>
        {paper.title}
      </p>

      {/* Authors */}
      <p className="text-xs text-slate-400 truncate mb-1">
        {firstAuthor}{coauthors ? ' et al.' : ''}
      </p>

      {/* Date */}
      <p className="text-[11px] text-slate-500">
        {format(paper.digestDate, 'MMM d, yyyy')} · arXiv:{paper.arxivId}
      </p>
    </button>
  );
}
