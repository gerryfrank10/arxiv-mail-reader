import { Paper } from '../types';
import { decodeLatex } from './latexDecode';

function joinContinuationLines(lines: string[], startIdx: number): [string, number] {
  let value = lines[startIdx];
  let i = startIdx + 1;
  while (i < lines.length && lines[i].startsWith(' ') && !lines[i].match(/^\s+(Title|Authors|Categories|Comments|Date|arXiv):/)) {
    value += ' ' + lines[i].trim();
    i++;
  }
  return [value, i - 1];
}

function isUrlLine(line: string): boolean {
  // Matches: \\ ( https://... ) or \ ( https://... )
  return !!(line.match(/^\\\\\s*\(\s*https?:\/\//) || line.match(/^\\ \(\s*https?:\/\//));
}

function isAbstractSeparator(line: string): boolean {
  // Exactly \\ on its own (two backslashes, nothing else after trim)
  return line.trim() === '\\\\';
}

export function parseArxivEmail(
  emailBody: string,
  emailId: string,
  digestSubject: string,
  digestDate: Date
): Paper[] {
  const papers: Paper[] = [];

  const text = emailBody.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n');

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();

    // Paper block starts with \\ on its own, followed by arXiv: on next line
    if (trimmed === '\\\\' && i + 1 < lines.length && lines[i + 1].trim().startsWith('arXiv:')) {
      i++; // move to arXiv: line

      const arxivLine = lines[i].trim();
      // Strip cross-listing annotation and "replaced with revised version" suffix
      const arxivId = arxivLine.replace('arXiv:', '').trim().split(/[\s(]/)[0];
      i++;

      // Date line (new submissions only): "Date: Sat, 14 Feb 2026 20:46:47 GMT   (559kb)"
      let date = '';
      let size = '';
      if (i < lines.length && lines[i].trim().startsWith('Date:')) {
        const dateLine = lines[i].trim().replace('Date:', '').trim();
        const sizeMatch = dateLine.match(/\((\d+\w+)\)\s*$/);
        if (sizeMatch) {
          size = sizeMatch[1];
          date = dateLine.replace(sizeMatch[0], '').trim();
        } else {
          date = dateLine;
        }
        i++;
      } else if (arxivLine.includes('replaced with revised version')) {
        // Date is embedded in the arXiv line for replacements — extract it
        const revMatch = arxivLine.match(/replaced with revised version\s+(.+?)\s+\((\d+\w+)\)/);
        if (revMatch) {
          date = revMatch[1].trim();
          size = revMatch[2];
        }
      }

      // Skip blank line after date/arXiv line
      if (i < lines.length && lines[i].trim() === '') i++;

      // Skip extra lines that aren't recognized fields (e.g. bare "replaced with..." continuation)
      while (
        i < lines.length &&
        lines[i].trim() !== '\\\\' &&
        !isUrlLine(lines[i]) &&
        !lines[i].startsWith('Title:') &&
        !lines[i].startsWith('Authors:') &&
        !lines[i].startsWith('Categories:') &&
        !lines[i].startsWith('Comments:') &&
        !lines[i].startsWith('Journal-ref:') &&
        lines[i].trim() !== ''
      ) {
        i++;
      }

      // Parse metadata fields — stop at \\ or \\ ( URL ) line
      let title = '';
      let authors = '';
      let categories: string[] = [];
      let comments = '';

      while (
        i < lines.length &&
        !isAbstractSeparator(lines[i]) &&
        !isUrlLine(lines[i])
      ) {
        const line = lines[i];
        if (line.startsWith('Title:')) {
          const [val, endIdx] = joinContinuationLines(lines, i);
          title = val.replace(/^Title:\s*/, '').trim();
          i = endIdx;
        } else if (line.startsWith('Authors:')) {
          const [val, endIdx] = joinContinuationLines(lines, i);
          authors = val.replace(/^Authors:\s*/, '').trim();
          i = endIdx;
        } else if (line.startsWith('Categories:')) {
          categories = line.replace(/^Categories:\s*/, '').trim().split(/\s+/).filter(Boolean);
        } else if (line.startsWith('Comments:')) {
          const [val, endIdx] = joinContinuationLines(lines, i);
          comments = val.replace(/^Comments:\s*/, '').trim();
          i = endIdx;
        }
        i++;
      }

      // Collect abstract — only present when there's a \\ separator before it
      const abstractLines: string[] = [];
      if (i < lines.length && isAbstractSeparator(lines[i])) {
        i++; // skip the \\ separator
        while (i < lines.length && !isUrlLine(lines[i])) {
          abstractLines.push(lines[i]);
          i++;
        }
      }
      // If we hit the URL line directly (no abstract for replacements), i is already there

      // Parse URL from the \\ ( url , size) line
      let url = `https://arxiv.org/abs/${arxivId}`;
      if (i < lines.length && isUrlLine(lines[i])) {
        const urlMatch = lines[i].match(/(https?:\/\/arxiv\.org\/abs\/[\w.]+)/);
        if (urlMatch) url = urlMatch[1];
      }

      const abstract = abstractLines
        .map(l => l.trim())
        .filter(Boolean)
        .join(' ')
        .trim();

      if (!title) { i++; continue; } // skip malformed blocks

      const authorList = authors
        .split(/\s+and\s+|,\s+/)
        .map(a => a.trim())
        .filter(Boolean);

      const decodedTitle   = decodeLatex(title);
      const decodedAuthors = decodeLatex(authors);
      const decodedList    = authorList.map(decodeLatex);

      papers.push({
        id: `${emailId}_${arxivId}`,
        arxivId,
        date,
        size,
        title:      decodedTitle,
        authors:    decodedAuthors,
        authorList: decodedList,
        categories,
        comments,
        abstract,
        url,
        pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
        emailId,
        digestSubject,
        digestDate,
      });
    }

    i++;
  }

  return papers;
}
