import { describe, expect, it } from 'vitest';
import { arxivSource, parseArxivEntries, planArxivHistory } from './arxiv.mjs';

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>https://arxiv.org/abs/1706.03762v7</id>
    <published>2017-06-12T17:57:34Z</published>
    <title>Attention is All You Need</title>
    <summary>We propose a new model &amp; test the approach.</summary>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
    <category term="cs.CL" />
    <arxiv:comment>15 pages</arxiv:comment>
  </entry>
</feed>`;

describe('arXiv history source plugin', () => {
  it('plans one monthly window per category and deduplicates categories', () => {
    const { config, slices } = planArxivHistory({
      categories: ['cs.AI', 'cs.LG', 'cs.AI'],
      fromYear: 2000,
      toYear: 2000,
    });
    expect(config.categories).toEqual(['cs.AI', 'cs.LG']);
    expect(slices).toHaveLength(24);
    expect(slices[0]).toMatchObject({ category: 'cs.AI', year: 2000, month: 1, from: '2000-01-01', to: '2000-01-31' });
    expect(slices[11]).toMatchObject({ category: 'cs.AI', year: 2000, month: 12, to: '2000-12-31' });
    expect(slices[12].category).toBe('cs.LG');
  });

  it('rejects invalid categories and ranges before queuing work', () => {
    expect(() => planArxivHistory({ categories: [], fromYear: 2000, toYear: 2000 })).toThrow(/category/i);
    expect(() => planArxivHistory({ categories: ['not a category'], fromYear: 2000, toYear: 2000 })).toThrow(/Invalid arXiv category/);
    expect(() => planArxivHistory({ categories: ['cs.AI'], fromYear: 1999, toYear: 2000 })).toThrow(/Start year/);
    expect(() => planArxivHistory({ categories: ['cs.AI'], fromYear: 2005, toYear: 2000 })).toThrow(/End year/);
  });

  it('parses and normalizes Atom metadata, preserving the published date', () => {
    const [paper] = parseArxivEntries(ATOM);
    expect(paper).toMatchObject({
      arxivId: '1706.03762',
      title: 'Attention is All You Need',
      abstract: 'We propose a new model & test the approach.',
      authorList: ['Ashish Vaswani', 'Noam Shazeer'],
      categories: ['cs.CL'],
      date: expect.stringContaining('2017'),
    });
  });

  it('returns a stable Paper shape for each fetched page', async () => {
    const slice = planArxivHistory({ categories: ['cs.CL'], fromYear: 2017, toYear: 2017 }).slices[5];
    const page = await arxivSource.fetchPage({
      slice,
      start: 0,
      pageSize: 1,
      jobId: 'job-1',
      request: async (query, start, limit) => {
        expect(query).toContain('cat:cs.CL');
        expect(query).toContain('submittedDate:');
        expect(start).toBe(0);
        expect(limit).toBe(1);
        return ATOM;
      },
    });
    expect(page.hasMore).toBe(true);
    expect(page.papers[0]).toMatchObject({
      id: 'imp-1706.03762',
      arxivId: '1706.03762',
      source: 'import',
      publisher: 'arXiv',
      emailId: 'history:job-1',
      digestDate: new Date('2017-06-12T17:57:34Z'),
    });
  });
});
