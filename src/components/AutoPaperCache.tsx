import { useCallback, useEffect, useRef } from 'react';
import { Paper } from '../types';
import { usePapers } from '../contexts/PapersContext';
import { useLibrary } from '../contexts/LibraryContext';
import { cachePaperFile } from '../utils/researchApi';

// Papers we've already asked the server to cache this session. Prevents
// re-downloading on every render, even if the request failed.
const attempted = new Set<string>();

/**
 * Background warm-up for the library.
 *
 * Saved papers are the ones the user is most likely to reopen, so we cache
 * their PDFs + text while the app is idle. Downloads are strictly sequential
 * (and additionally spaced by the server's arXiv rate limit), and opening a
 * paper at the same time is safe — the server de-duplicates in-flight fetches.
 * No UI: this is pure "make later opens instant".
 */
export default function AutoPaperCache() {
  const { storageMode, updatePaperMeta } = usePapers();
  const { savedPapers } = useLibrary();
  const queueRef    = useRef<Paper[]>([]);
  const runningRef  = useRef(false);
  const aliveRef    = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const run = useCallback(async () => {
    if (runningRef.current || !aliveRef.current) return;
    runningRef.current = true;
    try {
      while (aliveRef.current && queueRef.current.length > 0) {
        const paper = queueRef.current.shift()!;
        try {
          const res = await cachePaperFile(paper.id);
          updatePaperMeta(paper.id, {
            filePath:         res.paper.filePath,
            fileSize:         res.paper.fileSize,
            mimeType:         res.paper.mimeType,
            originalFilename: res.paper.originalFilename,
            uploadedAt:       res.paper.uploadedAt,
            hasFullText:      res.paper.hasFullText,
            fullTextChars:    res.paper.fullTextChars,
          });
        } catch (e) {
          console.warn(`[auto-cache] ${paper.arxivId} failed:`, e instanceof Error ? e.message : e);
        }
      }
    } finally {
      runningRef.current = false;
    }
  }, [updatePaperMeta]);

  useEffect(() => {
    if (storageMode !== 'server') return;
    let added = false;
    for (const p of savedPapers) {
      if (p.filePath || p.arxivId.startsWith('local:') || attempted.has(p.id)) continue;
      attempted.add(p.id);
      queueRef.current.push(p);
      added = true;
    }
    if (!added) return;
    // Let the inbox/list finish loading before starting network work.
    const timer = setTimeout(() => { void run(); }, 6000);
    return () => clearTimeout(timer);
  }, [storageMode, savedPapers, run]);

  return null;
}
