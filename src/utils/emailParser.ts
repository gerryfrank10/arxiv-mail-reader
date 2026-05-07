import { Paper } from '../types';

function joinContinuationLines(lines: string[], startIdx: number): [string, number] {
  let value = lines[startIdx];
  let i = startIdx + 1;
  while (i < lines.length && lines[i].startsWith(' ') && !lines[i].match(/^\s+(Title|Authors|Categories|Comments|Date|arXiv):/)) {
    value += ' ' + lines[i].trim();
    i++;
  }
  return [value, i - 1];
}

export function parseArxivEmail(
  emailBody: string,
  emailId: string,
  digestSubject: string,
  digestDate: Date
): Paper[] {
  const papers: Paper[] = [];

  // Normalize line endings
  const text = emailBody.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n');

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();

    // Paper block starts with \\ on its own, followed by arXiv: on next line
    if (trimmed === '\\\\' && i + 1 < lines.length && lines[i + 1].trim().startsWith('arXiv:')) {
      i++; // move to arXiv: line

      // Strip cross-listing annotation e.g. "2605.04305 (*cross-listing*)"
      const arxivId = lines[i].trim().replace('arXiv:', '').trim().split(/[\s(]/)[0];
      i++;

      // Date line: "Date: Sat, 14 Feb 2026 20:46:47 GMT   (559kb)"
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
      }

      // Skip blank line
      if (i < lines.length && lines[i].trim() === '') i++;

      // Parse metadata fields until we hit the abstract separator \\
      let title = '';
      let authors = '';
      let categories: string[] = [];
      let comments = '';

      while (i < lines.length && lines[i].trim() !== '\\\\') {
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

      // Skip the \\ abstract separator line
      if (i < lines.length && lines[i].trim() === '\\\\') i++;

      // Collect abstract lines until \\ ( url ) line
      const abstractLines: string[] = [];
      while (i < lines.length) {
        const line = lines[i];
        // End of abstract: line starting with \\ ( https://
        if (line.match(/^\\\\\s*\(\s*https?:\/\//) || line.match(/^\\ \(\s*https?:\/\//)) {
          break;
        }
        abstractLines.push(line);
        i++;
      }

      // Parse URL from the \\ ( url , size) line
      let url = `https://arxiv.org/abs/${arxivId}`;
      if (i < lines.length) {
        const urlMatch = lines[i].match(/(https?:\/\/arxiv\.org\/abs\/[\w.]+)/);
        if (urlMatch) url = urlMatch[1];
      }

      const abstract = abstractLines
        .map(l => l.trim())
        .filter(Boolean)
        .join(' ')
        .trim();

      // Parse author list (split by "and" and commas)
      const authorList = authors
        .split(/\s+and\s+|,\s+/)
        .map(a => a.trim())
        .filter(Boolean);

      papers.push({
        id: `${emailId}_${arxivId}`,
        arxivId,
        date,
        size,
        title,
        authors,
        authorList,
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
