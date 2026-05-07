import { Bookmark, BookmarkCheck } from 'lucide-react';
import { Paper } from '../types';
import { CATEGORY_COLORS, getCategoryLabel } from '../utils/categories';
import { computeAssessment, ASSESSMENT_BADGE } from '../utils/assessment';
import { useLibrary } from '../contexts/LibraryContext';
import { format } from 'date-fns';

interface Props {
  paper: Paper;
  isSelected: boolean;
  isSaved: boolean;
  onClick: () => void;
}

export default function PaperCard({ paper, isSelected, isSaved, onClick }: Props) {
  const { savePaper, unsavePaper } = useLibrary();
  const firstAuthor = paper.authorList[0] ?? paper.authors;
  const coauthors   = paper.authorList.length > 1;
  const assessment  = computeAssessment(paper);

  function handleBookmark(e: React.MouseEvent) {
    e.stopPropagation();
    if (isSaved) unsavePaper(paper.id);
    else savePaper(paper);
  }

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3.5 border-b border-slate-800/60 transition-all group ${
        isSelected
          ? 'bg-blue-600/20 border-l-2 border-l-blue-500'
          : 'hover:bg-slate-800/40 border-l-2 border-l-transparent'
      }`}
    >
      {/* Top row: categories + bookmark */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex flex-wrap gap-1 flex-1 min-w-0">
          {paper.categories.slice(0, 3).map(cat => {
            const color = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.default;
            return (
              <span key={cat} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${color}`} title={getCategoryLabel(cat)}>
                {cat}
              </span>
            );
          })}
          {paper.categories.length > 3 && (
            <span className="text-[10px] text-slate-500">+{paper.categories.length - 3}</span>
          )}
        </div>
        <button
          onClick={handleBookmark}
          title={isSaved ? 'Remove from library' : 'Save to library'}
          className={`shrink-0 p-0.5 rounded transition-all opacity-0 group-hover:opacity-100 ${isSaved ? 'opacity-100 text-amber-400 hover:text-amber-300' : 'text-slate-500 hover:text-amber-400'}`}
        >
          {isSaved ? <BookmarkCheck size={13} /> : <Bookmark size={13} />}
        </button>
      </div>

      {/* Title */}
      <p className={`text-sm font-medium leading-snug mb-1.5 line-clamp-2 ${isSelected ? 'text-white' : 'text-slate-200 group-hover:text-white'}`}>
        {paper.title}
      </p>

      {/* Authors */}
      <p className="text-xs text-slate-400 truncate mb-1.5">
        {firstAuthor}{coauthors ? ' et al.' : ''}
        {paper.authorList.length > 1 && (
          <span className="text-slate-600"> · {paper.authorList.length} authors</span>
        )}
      </p>

      {/* Bottom row: date + assessment badge */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500">
          {format(paper.digestDate, 'MMM d, yyyy')} · {paper.arxivId}
        </p>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${ASSESSMENT_BADGE[assessment.label]}`}>
          {assessment.label}
        </span>
      </div>
    </button>
  );
}
