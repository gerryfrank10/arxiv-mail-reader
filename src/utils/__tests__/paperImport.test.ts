import { describe, it, expect } from 'vitest';
import {
  extractArxivIds,
  parseBibtex,
  arxivIdFromBibEntry,
  bibEntryToPaper,
  metadataToPaper,
} from '../paperImport';

describe('extractArxivIds — plain ids', () => {
  it('extracts a modern id', () => {
    expect(extractArxivIds('2402.05576')).toEqual(['2402.05576']);
  });

  it('preserves version suffix', () => {
    // Versions are kept so importing a specific version pulls that version's
    // metadata (e.g. abstracts can change between versions).
    expect(extractArxivIds('2402.05576v3')).toEqual(['2402.05576v3']);
  });

  it('extracts a legacy id', () => {
    expect(extractArxivIds('cs/0610001')).toEqual(['cs/0610001']);
  });

  it('extracts legacy id with version', () => {
    expect(extractArxivIds('hep-th/9711200v2')).toEqual(['hep-th/9711200v2']);
  });

  it('lowercases legacy archive prefixes', () => {
    expect(extractArxivIds('CS/0610001')).toEqual(['cs/0610001']);
  });
});

describe('extractArxivIds — URLs', () => {
  it('parses an abs URL', () => {
    expect(extractArxivIds('https://arxiv.org/abs/2402.05576')).toEqual(['2402.05576']);
  });

  it('parses a pdf URL with version', () => {
    expect(extractArxivIds('https://arxiv.org/pdf/2402.05576v2')).toEqual(['2402.05576v2']);
  });

  it('parses an html URL', () => {
    expect(extractArxivIds('https://arxiv.org/html/2402.05576')).toEqual(['2402.05576']);
  });

  it('parses export.arxiv.org URLs', () => {
    expect(extractArxivIds('https://export.arxiv.org/abs/2402.05576')).toEqual(['2402.05576']);
  });

  it('parses an arXiv: prefix line', () => {
    expect(extractArxivIds('arXiv: 2402.05576')).toEqual(['2402.05576']);
  });
});

describe('extractArxivIds — bulk + dedupe', () => {
  it('extracts multiple ids from one blob', () => {
    const blob = `
      first paper: 2402.05576
      another:      https://arxiv.org/abs/2403.12345
      legacy:       cs/0610001
    `;
    const ids = extractArxivIds(blob);
    expect(ids).toContain('2402.05576');
    expect(ids).toContain('2403.12345');
    expect(ids).toContain('cs/0610001');
    expect(ids).toHaveLength(3);
  });

  it('dedupes exact repeats but keeps distinct versions', () => {
    // The bare id appears twice (deduped); the explicit v2 is a distinct request.
    const ids = extractArxivIds('2402.05576 2402.05576v2 https://arxiv.org/abs/2402.05576');
    expect(ids).toEqual(['2402.05576', '2402.05576v2']);
  });

  it('skips bare 4-digit years to avoid false positives', () => {
    // The modern regex requires the dot, so bare years like "2023" are
    // excluded by shape — this test just guards the behaviour.
    const ids = extractArxivIds('In 2023 we published cs/0610001 alongside 2402.05576');
    expect(ids).toContain('cs/0610001');
    expect(ids).toContain('2402.05576');
    expect(ids).not.toContain('2023');
    expect(ids).toHaveLength(2);
  });

  it('returns empty for input with no ids', () => {
    expect(extractArxivIds('just some prose with no ids in it')).toEqual([]);
  });

  it('handles 5-digit suffix ids (post-Jan-2015 format)', () => {
    expect(extractArxivIds('2401.12345')).toEqual(['2401.12345']);
  });
});

describe('parseBibtex', () => {
  // The parser requires the closing } to follow a newline directly (no
  // intervening whitespace), so all fixtures put it at column 0.
  it('parses a minimal entry', () => {
    const src = [
      '@article{lovelace1843,',
      '  author = {Ada Lovelace},',
      '  title  = {Notes on the Analytical Engine},',
      '  year   = {1843}',
      '}',
    ].join('\n');
    const out = parseBibtex(src);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('article');
    expect(out[0].key).toBe('lovelace1843');
    expect(out[0].fields.author).toBe('Ada Lovelace');
    expect(out[0].fields.title).toBe('Notes on the Analytical Engine');
    expect(out[0].fields.year).toBe('1843');
  });

  it('parses multiple entries', () => {
    const src = [
      '@article{a,',
      '  title = {A}, year = {2020}',
      '}',
      '@misc{b,',
      '  title = {B}, year = {2021}',
      '}',
    ].join('\n');
    const out = parseBibtex(src);
    expect(out.map(e => e.key)).toEqual(['a', 'b']);
    expect(out.map(e => e.type)).toEqual(['article', 'misc']);
  });

  it('handles quoted values', () => {
    const src = [
      '@misc{x,',
      '  title = "Hello World", year = 2020',
      '}',
    ].join('\n');
    const out = parseBibtex(src);
    expect(out[0].fields.title).toBe('Hello World');
    expect(out[0].fields.year).toBe('2020');
  });

  it('handles nested braces inside values', () => {
    const src = [
      '@article{x,',
      '  title = {The {GPT} model}, year = {2024}',
      '}',
    ].join('\n');
    const out = parseBibtex(src);
    expect(out[0].fields.title).toBe('The {GPT} model');
  });

  it('lowercases field names', () => {
    const src = [
      '@article{x,',
      '  Author = {A. N.}, Title = {T}, Year = {2024}',
      '}',
    ].join('\n');
    const out = parseBibtex(src);
    expect(out[0].fields.author).toBe('A. N.');
    expect(out[0].fields.title).toBe('T');
  });

  it('returns empty for non-bibtex input', () => {
    expect(parseBibtex('just prose')).toEqual([]);
  });
});

describe('arxivIdFromBibEntry', () => {
  it('extracts from eprint + archivePrefix=arxiv', () => {
    const e = { type: 'misc', key: 'x', fields: { archiveprefix: 'arXiv', eprint: '2402.05576' } };
    expect(arxivIdFromBibEntry(e)).toBe('2402.05576');
  });

  it('extracts from a bare eprint that looks like an arxiv id', () => {
    const e = { type: 'misc', key: 'x', fields: { eprint: '2402.05576' } };
    expect(arxivIdFromBibEntry(e)).toBe('2402.05576');
  });

  it('strips version suffix from eprint', () => {
    const e = { type: 'misc', key: 'x', fields: { archiveprefix: 'arxiv', eprint: '2402.05576v3' } };
    expect(arxivIdFromBibEntry(e)).toBe('2402.05576');
  });

  it('extracts from 10.48550/arXiv DOI', () => {
    const e = { type: 'article', key: 'x', fields: { doi: '10.48550/arXiv.2402.05576' } };
    expect(arxivIdFromBibEntry(e)).toBe('2402.05576');
  });

  it('falls back to url field', () => {
    const e = { type: 'misc', key: 'x', fields: { url: 'https://arxiv.org/abs/2402.05576v2' } };
    expect(arxivIdFromBibEntry(e)).toBe('2402.05576');
  });

  it('returns null when no id is recoverable', () => {
    const e = { type: 'misc', key: 'x', fields: { title: 'Some paper' } };
    expect(arxivIdFromBibEntry(e)).toBeNull();
  });
});

describe('bibEntryToPaper', () => {
  it('builds a Paper from a bibtex entry', () => {
    const src = [
      '@article{x,',
      '  author       = {Ada Lovelace and Charles Babbage},',
      '  title        = {On Engines},',
      '  year         = {1843},',
      '  archivePrefix = {arXiv},',
      '  eprint       = {2402.05576},',
      '  primaryClass = {cs.AI}',
      '}',
    ].join('\n');
    const [e] = parseBibtex(src);
    const p = bibEntryToPaper(e);
    expect(p).not.toBeNull();
    expect(p!.arxivId).toBe('2402.05576');
    expect(p!.title).toBe('On Engines');
    expect(p!.authorList).toEqual(['Ada Lovelace', 'Charles Babbage']);
    expect(p!.authors).toBe('Ada Lovelace, Charles Babbage');
    expect(p!.categories).toEqual(['cs.AI']);
    expect(p!.url).toBe('https://arxiv.org/abs/2402.05576');
    expect(p!.pdfUrl).toBe('https://arxiv.org/pdf/2402.05576');
    expect(p!.digestDate.getFullYear()).toBe(1843);
  });

  it('handles "Last, First" author format', () => {
    const src = [
      '@misc{x,',
      '  author = {Lovelace, Ada and Babbage, Charles},',
      '  eprint = {2402.05576}, year={2020}',
      '}',
    ].join('\n');
    const [e] = parseBibtex(src);
    const p = bibEntryToPaper(e);
    expect(p!.authorList).toEqual(['Ada Lovelace', 'Charles Babbage']);
  });

  it('returns null when there is no arxiv id', () => {
    const src = [
      '@misc{x,',
      '  title = {Untraceable}, year = {2020}',
      '}',
    ].join('\n');
    const [e] = parseBibtex(src);
    expect(bibEntryToPaper(e)).toBeNull();
  });
});

describe('metadataToPaper', () => {
  it('passes through fields and builds urls', () => {
    const meta = {
      arxivId:    '2402.05576',
      title:      'Hello',
      authors:    'A, B',
      authorList: ['A', 'B'],
      abstract:   'abs',
      categories: ['cs.AI'],
      date:       '7 Feb 2024',
      digestDate: new Date('2024-02-07'),
      pdfUrl:     'https://arxiv.org/pdf/2402.05576',
      url:        'https://arxiv.org/abs/2402.05576',
      comments:   '',
    };
    const p = metadataToPaper(meta);
    expect(p.id).toBe('imp-2402.05576');
    expect(p.arxivId).toBe('2402.05576');
    expect(p.title).toBe('Hello');
    expect(p.emailId).toBe('import');
    expect(p.digestSubject).toBe('Imported');
  });
});
