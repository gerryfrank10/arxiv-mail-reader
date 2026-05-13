import { useEffect, useRef, useState } from 'react';
import { Quote, Check, Copy, Download } from 'lucide-react';
import { Paper } from '../types';
import {
  CitationFormat,
  CITATION_FORMAT_LABELS,
  formatCitation,
  downloadBibFile,
} from '../utils/citationFormats';

interface Props {
  paper: Paper;
}

const FORMATS: CitationFormat[] = ['bibtex', 'apa', 'mla', 'chicago', 'plain'];

export default function CiteMenu({ paper }: Props) {
  const [open, setOpen]               = useState(false);
  const [copiedFmt, setCopiedFmt]     = useState<CitationFormat | null>(null);
  const [previewFmt, setPreviewFmt]   = useState<CitationFormat>('bibtex');
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / escape
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function copy(fmt: CitationFormat) {
    const text = formatCitation(paper, fmt);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedFmt(fmt);
      setTimeout(() => setCopiedFmt(null), 2000);
    } catch {
      // Clipboard blocked — fall back to a textarea select
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity  = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setCopiedFmt(fmt); setTimeout(() => setCopiedFmt(null), 2000); }
      catch { /* give up silently */ }
      document.body.removeChild(ta);
    }
  }

  const previewText = formatCitation(paper, previewFmt);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(v => !v)}
        title="Copy citation"
        className="flex items-center gap-2 px-5 py-2.5 border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
      >
        <Quote size={15} />
        Cite
      </button>

      {open && (
        <div className="absolute right-0 mt-2 z-30 w-[420px] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
          {/* Format list */}
          <div className="p-2 border-b border-slate-100">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 px-2 pt-1 pb-1.5">
              Copy as
            </p>
            <div className="grid grid-cols-1">
              {FORMATS.map(fmt => {
                const isCopied = copiedFmt === fmt;
                return (
                  <button
                    key={fmt}
                    onMouseEnter={() => setPreviewFmt(fmt)}
                    onFocus={() => setPreviewFmt(fmt)}
                    onClick={() => copy(fmt)}
                    className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                      previewFmt === fmt
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className="font-medium">{CITATION_FORMAT_LABELS[fmt]}</span>
                    {isCopied
                      ? <span className="flex items-center gap-1 text-emerald-600 text-xs"><Check size={13} /> Copied</span>
                      : <Copy size={13} className="text-slate-400" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preview */}
          <div className="p-3 bg-slate-50 border-b border-slate-100">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
              Preview · {CITATION_FORMAT_LABELS[previewFmt]}
            </p>
            <pre className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap font-mono max-h-44 overflow-y-auto">{previewText}</pre>
          </div>

          {/* Footer action */}
          <button
            onClick={() => { downloadBibFile([paper], `${paper.arxivId}.bib`); setOpen(false); }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <Download size={14} />
            Download .bib file
          </button>
        </div>
      )}
    </div>
  );
}
