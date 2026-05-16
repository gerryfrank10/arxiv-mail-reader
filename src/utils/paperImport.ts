import { Paper } from '../types';

// =========================================================================
// arXiv ID extraction
// =========================================================================

/**
 * Extract arXiv IDs from arbitrary user input.
 * Accepts: plain ids (2402.05576), versioned (2402.05576v3),
 *          legacy (cs/0610001), arxiv.org URLs (abs/, pdf/, html/),
 *          export.arxiv.org URLs, lines with surrounding whitespace.
 * Returns unique IDs in input order, version suffix stripped.
 */
export function extractArxivIds(input: string): string[] {
  const out = new Set<string>();
  const patterns = [
    /(?:arxiv\.org\/(?:abs|pdf|html)\/)((?:\d{4}\.\d{4,5}|[a-z-]+\/\d{7}))(?:v\d+)?/gi,
    /\barXiv:\s*((?:\d{4}\.\d{4,5}|[a-z-]+\/\d{7}))(?:v\d+)?\b/gi,
    /\b(\d{4}\.\d{4,5})(?:v\d+)?\b/g,
    /\b([a-z-]+\/\d{7})(?:v\d+)?\b/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(input)) !== null) {
      const id = m[1].toLowerCase();
      // skip obvious false positives (e.g. years)
      if (/^\d{4}$/.test(id)) continue;
      out.add(id);
    }
  }
  return [...out];
}

// =========================================================================
// Fetch from arXiv API (via our server proxy)
// =========================================================================

interface ArxivMetadata {
  arxivId: string;
  title: string;
  authors: string;
  authorList: string[];
  abstract: string;
  categories: string[];
  date: string;       // human-readable published date
  digestDate: Date;
  pdfUrl: string;
  url: string;
  comments: string;
}

/**
 * Fetch a single paper's metadata from the arXiv API via our proxy.
 * Parses the Atom XML directly so we get title/authors/categories too,
 * not just the abstract.
 */
export async function fetchArxivMetadata(arxivId: string, signal?: AbortSignal): Promise<ArxivMetadata> {
  const resp = await fetch(`/api/arxiv-metadata?id=${encodeURIComponent(arxivId)}`, { signal });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `Failed to fetch ${arxivId} (HTTP ${resp.status})`);
  }
  const data = await resp.json() as ArxivMetadataRaw;
  return {
    arxivId:    data.arxivId,
    title:      data.title,
    authors:    data.authorList.join(', '),
    authorList: data.authorList,
    abstract:   data.abstract,
    categories: data.categories,
    date:       data.date,
    digestDate: new Date(data.published || Date.now()),
    pdfUrl:     `https://arxiv.org/pdf/${data.arxivId}`,
    url:        `https://arxiv.org/abs/${data.arxivId}`,
    comments:   data.comments ?? '',
  };
}

interface ArxivMetadataRaw {
  arxivId: string;
  title: string;
  authorList: string[];
  abstract: string;
  categories: string[];
  date: string;
  published: string;
  comments?: string;
}

// =========================================================================
// Convert metadata to a Paper for the store
// =========================================================================

export function metadataToPaper(meta: ArxivMetadata): Paper {
  return {
    id:            `imp-${meta.arxivId}`,
    arxivId:       meta.arxivId,
    date:          meta.date,
    size:          '',
    title:         meta.title,
    authors:       meta.authors,
    authorList:    meta.authorList,
    categories:    meta.categories,
    comments:      meta.comments,
    abstract:      meta.abstract,
    url:           meta.url,
    pdfUrl:        meta.pdfUrl,
    emailId:       'import',
    digestSubject: 'Imported',
    digestDate:    meta.digestDate,
  };
}

// =========================================================================
// BibTeX parser (loose — just enough to extract arXiv eprints + manual fields)
// =========================================================================

export interface BibtexEntry {
  type:    string;             // article, misc, ...
  key:     string;
  fields:  Record<string, string>;
}

export function parseBibtex(source: string): BibtexEntry[] {
  const entries: BibtexEntry[] = [];
  // Strip comments
  const cleaned = source.replace(/^%.*$/gm, '');

  // Match @type{key, ... }  (very permissive)
  const reEntry = /@(\w+)\s*\{\s*([^,\s]+)\s*,([\s\S]*?)\n\}\s*(?=@|$)/g;
  let m;
  while ((m = reEntry.exec(cleaned)) !== null) {
    const type = m[1].toLowerCase();
    const key  = m[2].trim();
    const body = m[3];

    const fields: Record<string, string> = {};
    // Match field = value pairs. Value can be {…} or "…" or a bare number.
    const reField = /(\w+)\s*=\s*(\{(?:[^{}]|\{[^{}]*\})*\}|"[^"]*"|\d+)/g;
    let f;
    while ((f = reField.exec(body)) !== null) {
      const name  = f[1].toLowerCase();
      let value = f[2].trim();
      // Strip enclosing braces/quotes
      if ((value.startsWith('{') && value.endsWith('}')) ||
          (value.startsWith('"') && value.endsWith('"'))) {
        value = value.slice(1, -1);
      }
      // Collapse whitespace
      value = value.replace(/\s+/g, ' ').trim();
      fields[name] = value;
    }

    entries.push({ type, key, fields });
  }
  return entries;
}

/** Extract a plain arXiv id from a BibTeX entry's fields, if present. */
export function arxivIdFromBibEntry(e: BibtexEntry): string | null {
  // Priority: eprint with arxiv-y prefix, then archivePrefix=arXiv + eprint,
  // then a doi like 10.48550/arXiv.2401.12345, then a url field.
  const archive = (e.fields.archiveprefix || '').toLowerCase();
  const eprint  = e.fields.eprint || '';
  if (eprint && (archive === 'arxiv' || /^\d{4}\.\d{4,5}|^[a-z-]+\/\d{7}/i.test(eprint))) {
    return eprint.replace(/v\d+$/i, '');
  }
  const doi = e.fields.doi || '';
  const doiMatch = doi.match(/10\.48550\/arxiv\.(\S+)/i);
  if (doiMatch) return doiMatch[1].replace(/v\d+$/i, '');
  const fromUrl = extractArxivIds(e.fields.url || '');
  if (fromUrl.length > 0) return fromUrl[0];
  const fromAnything = extractArxivIds(JSON.stringify(e.fields));
  return fromAnything[0] ?? null;
}

/** Build a Paper directly from a BibTeX entry without hitting arXiv (offline). */
export function bibEntryToPaper(e: BibtexEntry): Paper | null {
  // Without arxivId we can't fit the data model nicely; skip those for now
  const arxivId = arxivIdFromBibEntry(e);
  if (!arxivId) return null;
  const title       = e.fields.title || '(untitled)';
  const authorRaw   = e.fields.author || '';
  const authorList  = authorRaw
    ? authorRaw.split(/\s+and\s+/i).map(a => normalizeAuthorName(a)).filter(Boolean)
    : [];
  const year        = e.fields.year || '';
  const date        = year ? `1 Jan ${year}` : '';
  const categories  = (e.fields.primaryclass || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);
  return {
    id:            `bib-${arxivId}`,
    arxivId,
    date,
    size:          '',
    title,
    authors:       authorList.join(', '),
    authorList,
    categories,
    comments:      '',
    abstract:      e.fields.abstract || '',
    url:           `https://arxiv.org/abs/${arxivId}`,
    pdfUrl:        `https://arxiv.org/pdf/${arxivId}`,
    emailId:       'import',
    digestSubject: 'Imported (BibTeX)',
    digestDate:    year ? new Date(parseInt(year, 10), 0, 1) : new Date(),
  };
}

// "Last, First" → "First Last"; "First Last" → "First Last"; trims junk
function normalizeAuthorName(raw: string): string {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (s.includes(',')) {
    const [last, first] = s.split(',').map(x => x.trim());
    return `${first} ${last}`.trim();
  }
  return s;
}
