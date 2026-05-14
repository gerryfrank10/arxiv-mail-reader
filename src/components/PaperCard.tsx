import { Bookmark, BookmarkCheck, Target } from 'lucide-react';
import { Paper } from '../types';
import { CATEGORY_COLORS, getCategoryLabel } from '../utils/categories';
import { computeAssessment, ASSESSMENT_BADGE } from '../utils/assessment';
import { useLibrary } from '../contexts/LibraryContext';
import { useTracking } from '../contexts/TrackingContext';
import { TRACKER_COLOR_CLASSES } from '../utils/trackerScoring';
import { format } from 'date-fns';

interface Props {
  paper: Paper;
  isSelected: boolean;
  isSaved: boolean;
  isRead?: boolean;
  onClick: () => void;
}

export default function PaperCard({ paper, isSelected, isSaved, isRead = true, onClick }: Props) {
  const { savePaper, unsavePaper } = useLibrary();
  const { scoresForPaper, trackers } = useTracking();
  const firstAuthor = paper.authorList[0] ?? paper.authors;
  const coauthors   = paper.authorList.length > 1;
  const assessment  = computeAssessment(paper);
  // Surface up to 2 tracker matches above threshold (best signal first)
  const trackerHits = scoresForPaper(paper.id)
    .map(s => ({ s, t: trackers.find(tr => tr.id === s.trackerId) }))
    .filter(x => x.t && x.t.enabled && x.s.score >= x.t.minScore)
    .slice(0, 2);

  function handleBookmark(e: React.MouseEvent) {
    e.stopPropagation();
    if (isSaved) unsavePaper(paper.id);
    else savePaper(paper);
  }

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      className={`w-full text-left px-4 py-3.5 border-b border-slate-800/60 transition-all group cursor-pointer ${
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
      <div className="flex items-start gap-1.5 mb-1.5">
        {!isRead && !isSelected && (
          <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
        )}
        <p className={`text-sm font-medium leading-snug line-clamp-2 ${isSelected ? 'text-white' : 'text-slate-200 group-hover:text-white'}`}>
          {paper.title}
        </p>
      </div>

      {/* Authors */}
      <p className="text-xs text-slate-400 truncate mb-1.5">
        {firstAuthor}{coauthors ? ' et al.' : ''}
        {paper.authorList.length > 1 && (
          <span className="text-slate-600"> · {paper.authorList.length} authors</span>
        )}
      </p>

      {/* Tracker matches — small inline chips */}
      {trackerHits.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {trackerHits.map(({ s, t }) => {
            const cls = TRACKER_COLOR_CLASSES[t!.color] ?? TRACKER_COLOR_CLASSES.blue;
            return (
              <span
                key={s.id}
                title={`${t!.name} · ${s.score}/100 · ${s.rationale}`}
                className={`inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded ${cls.chip}`}
              >
                <Target size={8} />
                {t!.name.length > 18 ? t!.name.slice(0, 16) + '…' : t!.name}
                <span className="font-bold">{s.score}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* Bottom row: date + assessment badge */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500">
          {format(paper.digestDate, 'MMM d, yyyy')} · {paper.arxivId}
        </p>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${ASSESSMENT_BADGE[assessment.label]}`}>
          {assessment.label}
        </span>
      </div>
    </div>
  );
}
