import { useEffect, useMemo, useState } from 'react';

export interface PaginationResult<T> {
  /** Items in the current page (already sliced). */
  slice: T[];
  /** Zero-based current page index, clamped to valid range. */
  page: number;
  /** Setter that also clamps to the valid range. */
  setPage: (n: number) => void;
  /** Total pages (always >= 1). */
  totalPages: number;
  /** Page size in use. */
  pageSize: number;
  /** Setter so the UI can offer page-size controls. */
  setPageSize: (n: number) => void;
  /** Inclusive index range of items on the current page, for "showing 1–25 of 312" labels. */
  rangeStart: number;
  rangeEnd: number;
  /** Total item count (raw). */
  total: number;
}

/**
 * Reactive client-side pagination. Resets to page 0 whenever the items
 * array shrinks below the current page (e.g. after a filter change).
 *
 * Page-size changes preserve the FIRST visible item so the user doesn't
 * lose their place when toggling 25 → 100.
 */
export function usePagination<T>(items: T[], defaultPageSize = 25): PaginationResult<T> {
  const [page, _setPage]         = useState(0);
  const [pageSize, _setPageSize] = useState(defaultPageSize);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Clamp page if items shrink
  useEffect(() => {
    if (page > totalPages - 1) _setPage(0);
  }, [page, totalPages]);

  const setPage = (n: number) => {
    _setPage(Math.max(0, Math.min(n, totalPages - 1)));
  };

  const setPageSize = (n: number) => {
    // Anchor to the first visible item so the user keeps roughly the same context
    const firstVisible = page * pageSize;
    const newPage      = Math.floor(firstVisible / n);
    _setPageSize(n);
    _setPage(Math.max(0, newPage));
  };

  const slice = useMemo(
    () => items.slice(page * pageSize, (page + 1) * pageSize),
    [items, page, pageSize],
  );
  const rangeStart = total === 0 ? 0 : page * pageSize + 1;
  const rangeEnd   = Math.min((page + 1) * pageSize, total);

  return { slice, page, setPage, totalPages, pageSize, setPageSize, rangeStart, rangeEnd, total };
}
