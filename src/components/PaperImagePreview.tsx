import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Image as ImageIcon, Loader2 } from 'lucide-react';
import { apiGetPaperFigure, apiGetPaperFigures } from '../utils/researchApi';
import type { Paper } from '../types';

// Lazy figure carousel for feed rows. Figures are extracted once per paper on
// the server and cached; the preview only requests them when the row scrolls
// near the viewport. Shared by the "For you" and "Following" feeds.
export default function PaperImagePreview({ paper, storageMode, updatePaperMeta }: {
  paper: Paper;
  storageMode: 'idb' | 'server';
  updatePaperMeta: (id: string, patch: Partial<Paper>) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const requested = useRef(false);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<'idle' | 'loading' | 'image' | 'none' | 'error'>(
    paper.thumbnailChecked && !paper.thumbnailAvailable ? 'none' : 'idle',
  );
  const [figures, setFigures] = useState<Array<{ index: number; pageNumber?: number | null; width: number; height: number }>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (storageMode !== 'server' || (paper.thumbnailChecked && !paper.thumbnailAvailable)) return;
    if (requested.current) return;
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    const load = async () => {
      if (requested.current || cancelled) return;
      requested.current = true;
      setState('loading');
      try {
        const result = await apiGetPaperFigures(paper.id);
        if (cancelled) return;
        setFigures(result);
        setState(result.length > 0 ? 'image' : 'none');
        updatePaperMeta(paper.id, { thumbnailChecked: true, thumbnailAvailable: result.length > 0 });
      } catch (e) {
        if (!cancelled) { setState('error'); console.warn(`[feed] figure extraction failed for ${paper.arxivId}:`, e); }
      }
    };
    if (typeof IntersectionObserver === 'undefined') { void load(); return () => { cancelled = true; }; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void load(); }
    }, { rootMargin: '180px 0px' });
    observer.observe(host);
    return () => { cancelled = true; observer.disconnect(); };
  }, [paper.id, paper.arxivId, paper.thumbnailChecked, paper.thumbnailAvailable, storageMode, retry, updatePaperMeta]);

  useEffect(() => {
    const figure = figures[activeIndex];
    if (state !== 'image' || !figure) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setImageUrl(null);
    apiGetPaperFigure(paper.id, figure.index)
      .then(blob => { if (!cancelled) { objectUrl = URL.createObjectURL(blob); setImageUrl(objectUrl); } })
      .catch(e => { if (!cancelled) { setState('error'); console.warn(`[feed] figure image failed for ${paper.arxivId}:`, e); } });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [paper.id, paper.arxivId, state, figures, activeIndex]);

  if (state === 'none' || storageMode !== 'server') return null;
  return (
    <div ref={hostRef} className="mt-3">
      {state === 'image' && figures.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-[#e7e5df] bg-white">
          <div className="relative flex h-[min(65vh,420px)] min-h-[140px] items-center justify-center bg-[#fafaf8]" aria-roledescription="carousel" aria-label={`Figures from ${paper.title}`}>
            {imageUrl ? (
              <img src={imageUrl} alt={`Figure ${activeIndex + 1} from ${paper.title}${figures[activeIndex].pageNumber ? `, page ${figures[activeIndex].pageNumber}` : ''}`} draggable={false} className="block h-full w-full select-none object-contain" />
            ) : <div className="flex items-center gap-2 text-[11px] text-slate-400"><Loader2 size={12} className="animate-spin" /> Loading figure…</div>}
            {figures.length > 1 && (
              <>
                <button type="button" aria-label="Previous figure" onClick={() => setActiveIndex(i => (i - 1 + figures.length) % figures.length)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full border border-white/70 bg-white/90 p-1.5 text-slate-700 shadow hover:bg-white"><ChevronLeft size={16} /></button>
                <button type="button" aria-label="Next figure" onClick={() => setActiveIndex(i => (i + 1) % figures.length)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full border border-white/70 bg-white/90 p-1.5 text-slate-700 shadow hover:bg-white"><ChevronRight size={16} /></button>
              </>
            )}
          </div>
          <div className="border-t border-[#eeede8] px-3 py-1.5 text-[10px] text-slate-400">
            Figure {activeIndex + 1} of {figures.length}{figures[activeIndex].pageNumber ? ` · page ${figures[activeIndex].pageNumber}` : ''}
          </div>
        </div>
      ) : state === 'loading' ? (
        <div className="flex items-center gap-2 text-[11px] text-slate-400"><Loader2 size={12} className="animate-spin" /> Finding figures…</div>
      ) : state === 'error' ? (
        <button onClick={() => { requested.current = false; setRetry(n => n + 1); }} className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-700"><ImageIcon size={12} /> Preview unavailable · retry</button>
      ) : null}
    </div>
  );
}