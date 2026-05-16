import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { PaginationResult } from '../hooks/usePagination';

interface Props<T> {
  pagination: PaginationResult<T>;
  /** Page-size options. If undefined, the page-size selector is hidden. */
  pageSizes?: number[];
  /** 'dark' for sidebar (slate-900 bg); 'light' for main content (white bg). */
  variant?: 'dark' | 'light';
  /** 'sm' or 'md' — controls density. */
  size?: 'sm' | 'md';
  /** Label for the items (default: 'items'). */
  label?: string;
  /** Sticky positioning at the bottom of a scroll container. */
  sticky?: boolean;
}

export default function Pager<T>({
  pagination, pageSizes, variant = 'light', size = 'md', label = 'items', sticky = false,
}: Props<T>) {
  const { page, setPage, totalPages, pageSize, setPageSize, rangeStart, rangeEnd, total } = pagination;
  if (total === 0) return null;

  const dark = variant === 'dark';
  const sm   = size === 'sm';
  const bg            = dark ? 'bg-slate-900/95 border-slate-800 text-slate-400' : 'bg-white border-slate-200 text-slate-600';
  const btnBase       = `${sm ? 'p-1' : 'p-1.5'} rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed`;
  const btnHover      = dark ? 'hover:text-white hover:bg-slate-800' : 'hover:text-slate-900 hover:bg-slate-100';
  const muted         = dark ? 'text-slate-500' : 'text-slate-400';
  const fontSize      = sm ? 'text-[10px]' : 'text-xs';
  const sizeIcon      = sm ? 11 : 13;

  return (
    <div
      className={`flex items-center justify-between gap-2 px-3 py-2 border-t backdrop-blur-sm ${bg} ${sticky ? 'sticky bottom-0 z-10' : ''}`}
    >
      <p className={`${fontSize} ${muted} truncate`}>
        {total === 1
          ? `1 ${label.replace(/s$/, '')}`
          : <>showing <span className={dark ? 'text-slate-300' : 'text-slate-700'}>{rangeStart}–{rangeEnd}</span> of {total.toLocaleString()} {label}</>}
      </p>

      <div className="flex items-center gap-0.5 shrink-0">
        {pageSizes && pageSizes.length > 0 && (
          <select
            value={pageSize}
            onChange={e => setPageSize(parseInt(e.target.value, 10))}
            className={`${fontSize} ${dark ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-600'} border rounded px-1.5 py-0.5 mr-1 focus:outline-none`}
            title="Page size"
          >
            {pageSizes.map(n => <option key={n} value={n}>{n}/page</option>)}
          </select>
        )}
        <button
          onClick={() => setPage(0)}
          disabled={page === 0}
          aria-label="First page"
          className={`${btnBase} ${btnHover}`}
        >
          <ChevronsLeft size={sizeIcon} />
        </button>
        <button
          onClick={() => setPage(page - 1)}
          disabled={page === 0}
          aria-label="Previous page"
          className={`${btnBase} ${btnHover}`}
        >
          <ChevronLeft size={sizeIcon} />
        </button>
        <span className={`${fontSize} ${dark ? 'text-slate-300' : 'text-slate-700'} font-medium px-1.5`}>
          {page + 1}<span className={muted}> / {totalPages}</span>
        </span>
        <button
          onClick={() => setPage(page + 1)}
          disabled={page >= totalPages - 1}
          aria-label="Next page"
          className={`${btnBase} ${btnHover}`}
        >
          <ChevronRight size={sizeIcon} />
        </button>
        <button
          onClick={() => setPage(totalPages - 1)}
          disabled={page >= totalPages - 1}
          aria-label="Last page"
          className={`${btnBase} ${btnHover}`}
        >
          <ChevronsRight size={sizeIcon} />
        </button>
      </div>
    </div>
  );
}
