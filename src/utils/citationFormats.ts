import { Paper } from '../types';
import { decodeLatex } from './latexDecode';

export type CitationFormat = 'bibtex' | 'apa' | 'mla' | 'chicago' | 'plain';

export const CITATION_FORMAT_LABELS: Record<CitationFormat, string> = {
  bibtex:  'BibTeX',
  apa:     'APA',
  mla:     'MLA',
  chicago: 'Chicago',
  plain:   'Plain text',
};

// ---------- helpers ----------

interface ParsedAuthor {
  first: string;   // "Ada Linn"
  last:  string;   // "Lovelace"
  full:  string;   // "Ada Linn Lovelace"
  initials: string; // "A. L."
}

function parseAuthor(raw: string): ParsedAuthor {
  const full = decodeLatex(raw).replace(/\s+/g, ' ').trim();
  if (!full) return { first: '', last: '', full: '', initials: '' };
  const parts = full.split(' ');
  if (parts.length === 1) {
    return { first: '', last: parts[0], full, initials: '' };
  }
  const last  = parts[parts.length - 1];
  const first = parts.slice(0, -1).join(' ');
  const initials = first
    .split(/[\s.-]+/)
    .filter(Boolean)
    .map(p => p[0].toUpperCase() + '.')
    .join(' ');
  return { first, last, full, initials };
}

function getYear(paper: Paper): string {
  // Prefer the digest's parsed date string — fall back to digestDate
  const fromString = paper.date?.match(/\b(19|20)\d{2}\b/)?.[0];
  if (fromString) return fromString;
  return String(paper.digestDate.getFullYear());
}

function cleanTitle(paper: Paper): string {
  return decodeLatex(paper.title).replace(/\s+/g, ' ').trim();
}

function arxivUrl(paper: Paper): string {
  return paper.url || `https://arxiv.org/abs/${paper.arxivId}`;
}

function bibtexKey(authors: ParsedAuthor[], year: string, title: string): string {
  const last = (authors[0]?.last || 'anon').toLowerCase().replace(/[^a-z]/g, '');
  const word = title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .split(/\s+/)
    .find(w => w.length > 3 && !['the', 'with', 'from', 'into', 'using', 'this', 'that'].includes(w))
    ?? 'paper';
  return `${last}${year}${word}`;
}

// Escape characters that BibTeX treats specially
function escapeBibtex(s: string): string {
  return s
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1');
}

// ---------- formatters ----------

export function toBibTeX(paper: Paper): string {
  const authors = paper.authorList.map(parseAuthor);
  const year    = getYear(paper);
  const title   = cleanTitle(paper);
  const key     = bibtexKey(authors, year, title);
  const authorField = authors.map(a => a.full).join(' and ');
  const primary = paper.categories[0] ?? '';

  const lines = [
    `@article{${key},`,
    `  author        = {${escapeBibtex(authorField)}},`,
    `  title         = {{${escapeBibtex(title)}}},`,
    `  year          = {${year}},`,
    `  eprint        = {${paper.arxivId}},`,
    `  archivePrefix = {arXiv},`,
  ];
  if (primary) lines.push(`  primaryClass  = {${primary}},`);
  lines.push(`  url           = {${arxivUrl(paper)}},`);
  lines.push(`}`);
  return lines.join('\n');
}

export function toAPA(paper: Paper): string {
  const authors = paper.authorList.map(parseAuthor);
  const year    = getYear(paper);
  const title   = cleanTitle(paper);

  const namePieces = authors.map(a => a.initials ? `${a.last}, ${a.initials}` : a.last);
  let authorStr: string;
  if (namePieces.length === 0)      authorStr = '';
  else if (namePieces.length === 1) authorStr = namePieces[0];
  else if (namePieces.length === 2) authorStr = `${namePieces[0]}, & ${namePieces[1]}`;
  else if (namePieces.length <= 20) authorStr = `${namePieces.slice(0, -1).join(', ')}, & ${namePieces[namePieces.length - 1]}`;
  else authorStr = `${namePieces.slice(0, 19).join(', ')}, ... ${namePieces[namePieces.length - 1]}`;

  return `${authorStr} (${year}). ${title}. arXiv. ${arxivUrl(paper)}`;
}

export function toMLA(paper: Paper): string {
  const authors = paper.authorList.map(parseAuthor);
  const year    = getYear(paper);
  const title   = cleanTitle(paper);

  let authorStr: string;
  if (authors.length === 0) authorStr = '';
  else if (authors.length === 1) {
    const a = authors[0];
    authorStr = a.first ? `${a.last}, ${a.first}` : a.last;
  } else if (authors.length === 2) {
    const [a, b] = authors;
    authorStr = `${a.first ? `${a.last}, ${a.first}` : a.last}, and ${b.full}`;
  } else {
    const a = authors[0];
    authorStr = `${a.first ? `${a.last}, ${a.first}` : a.last}, et al`;
  }

  const url = arxivUrl(paper).replace(/^https?:\/\//, '');
  return `${authorStr}. "${title}." arXiv, ${year}, ${url}.`;
}

export function toChicago(paper: Paper): string {
  const authors = paper.authorList.map(parseAuthor);
  const year    = getYear(paper);
  const title   = cleanTitle(paper);

  let authorStr: string;
  if (authors.length === 0) authorStr = '';
  else if (authors.length === 1) {
    const a = authors[0];
    authorStr = a.first ? `${a.last}, ${a.first}` : a.last;
  } else {
    const first = authors[0];
    const firstName = first.first ? `${first.last}, ${first.first}` : first.last;
    const rest = authors.slice(1).map(a => a.full);
    if (rest.length === 1) authorStr = `${firstName}, and ${rest[0]}`;
    else                   authorStr = `${firstName}, ${rest.slice(0, -1).join(', ')}, and ${rest[rest.length - 1]}`;
  }

  return `${authorStr}. ${year}. "${title}." arXiv preprint arXiv:${paper.arxivId}. ${arxivUrl(paper)}.`;
}

export function toPlain(paper: Paper): string {
  const authors = paper.authorList.map(parseAuthor);
  const year    = getYear(paper);
  const title   = cleanTitle(paper);
  const names   = authors.length > 3
    ? `${authors.slice(0, 3).map(a => a.full).join(', ')}, et al.`
    : authors.map(a => a.full).join(', ');
  return `${names} (${year}). ${title}. arXiv:${paper.arxivId}.`;
}

export function formatCitation(paper: Paper, format: CitationFormat): string {
  switch (format) {
    case 'bibtex':  return toBibTeX(paper);
    case 'apa':     return toAPA(paper);
    case 'mla':     return toMLA(paper);
    case 'chicago': return toChicago(paper);
    case 'plain':   return toPlain(paper);
  }
}

// ---------- .bib download ----------

export function buildBibFile(papers: Paper[]): string {
  return papers.map(toBibTeX).join('\n\n') + '\n';
}

export function downloadBibFile(papers: Paper[], filename = 'arxiv-papers.bib'): void {
  const blob = new Blob([buildBibFile(papers)], { type: 'application/x-bibtex;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
