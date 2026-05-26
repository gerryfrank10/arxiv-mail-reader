import { describe, it, expect } from 'vitest';
import { SimilarityIndex } from '../textSimilarity';
import type { Paper } from '../../types';

function mkPaper(over: Partial<Paper> & { arxivId: string; title: string }): Paper {
  const base: Paper = {
    id:            `t-${over.arxivId}`,
    arxivId:       over.arxivId,
    date:          '',
    size:          '',
    title:         over.title,
    authors:       (over.authorList ?? []).join(', '),
    authorList:    over.authorList ?? [],
    categories:    over.categories ?? [],
    comments:      '',
    abstract:      over.abstract ?? '',
    url:           '',
    pdfUrl:        '',
    emailId:       'test',
    digestSubject: 'test',
    digestDate:    new Date(0),
  };
  return { ...base, ...over };
}

describe('SimilarityIndex — basics', () => {
  it('reports size and a stable signature', () => {
    const papers = [
      mkPaper({ arxivId: '2400.00001', title: 'foo' }),
      mkPaper({ arxivId: '2400.00002', title: 'bar' }),
    ];
    const idx = new SimilarityIndex(papers);
    expect(idx.size).toBe(2);

    const idx2 = new SimilarityIndex([...papers].reverse());
    // Signature depends on sorted ids so ordering must not affect it
    expect(idx2.signature).toBe(idx.signature);
  });

  it('returns empty for unknown source id', () => {
    const idx = new SimilarityIndex([mkPaper({ arxivId: '2400.00001', title: 'x' })]);
    expect(idx.similar('nonexistent')).toEqual([]);
  });

  it('excludes the source paper from its own results', () => {
    const papers = [
      mkPaper({ arxivId: '2400.00001', title: 'attention is all you need', abstract: 'transformers self attention' }),
      mkPaper({ arxivId: '2400.00002', title: 'attention is all you need', abstract: 'transformers self attention' }),
    ];
    const idx = new SimilarityIndex(papers);
    const results = idx.similar('2400.00001');
    expect(results.find(r => r.paper.arxivId === '2400.00001')).toBeUndefined();
  });
});

describe('SimilarityIndex — ranking', () => {
  // Build a small corpus where one paper is *clearly* most similar to the
  // query and another is unrelated. The exact scores don't matter; only
  // the ordering does.
  const papers: Paper[] = [
    mkPaper({
      arxivId:    'q',
      title:      'transformer architecture for language models',
      abstract:   'we introduce transformer self attention positional encoding',
      categories: ['cs.CL', 'cs.LG'],
      authorList: ['Alice'],
    }),
    mkPaper({
      arxivId:    'near',
      title:      'transformer language model improvements',
      abstract:   'transformer self attention positional encoding scaling',
      categories: ['cs.CL'],
      authorList: ['Bob'],
    }),
    mkPaper({
      arxivId:    'far',
      title:      'photonic crystal lattice dynamics',
      abstract:   'lattice photon optical waveguide bandgap',
      categories: ['physics.optics'],
      authorList: ['Eve'],
    }),
  ];

  it('ranks topically-near papers above unrelated papers', () => {
    const idx = new SimilarityIndex(papers);
    const results = idx.similar('q', 10, 0);
    expect(results[0].paper.arxivId).toBe('near');
    const nearScore = results.find(r => r.paper.arxivId === 'near')!.score;
    const farScore  = results.find(r => r.paper.arxivId === 'far')!.score;
    expect(nearScore).toBeGreaterThan(farScore);
  });

  it('caps result count via k', () => {
    const idx = new SimilarityIndex(papers);
    expect(idx.similar('q', 1, 0)).toHaveLength(1);
  });

  it('filters out near-zero matches via minScore', () => {
    const idx = new SimilarityIndex(papers);
    const all  = idx.similar('q', 10, 0);
    const high = idx.similar('q', 10, 0.5);
    expect(high.length).toBeLessThanOrEqual(all.length);
    for (const r of high) expect(r.score).toBeGreaterThanOrEqual(0.5);
  });

  it('returns scorePct as 0..100 integer', () => {
    const idx = new SimilarityIndex(papers);
    const results = idx.similar('q', 10, 0);
    for (const r of results) {
      expect(r.scorePct).toBeGreaterThanOrEqual(0);
      expect(r.scorePct).toBeLessThanOrEqual(100);
      expect(Number.isInteger(r.scorePct)).toBe(true);
    }
  });

  it('reports the three signal components per result', () => {
    const idx = new SimilarityIndex(papers);
    const r = idx.similar('q', 10, 0).find(x => x.paper.arxivId === 'near')!;
    expect(r.signals.text).toBeGreaterThan(0);       // shared transformer / attention vocab
    expect(r.signals.categories).toBeGreaterThan(0); // both have cs.CL
    expect(r.signals.authors).toBe(0);               // different authors
  });

  it('rewards author overlap', () => {
    const ps: Paper[] = [
      mkPaper({ arxivId: 'q',  title: 't', abstract: 'a', authorList: ['Same Person'] }),
      mkPaper({ arxivId: 'm1', title: 't', abstract: 'a', authorList: ['Same Person'] }),
      mkPaper({ arxivId: 'm2', title: 't', abstract: 'a', authorList: ['Other Person'] }),
    ];
    const idx = new SimilarityIndex(ps);
    const r = idx.similar('q', 10, 0);
    const m1 = r.find(x => x.paper.arxivId === 'm1')!;
    const m2 = r.find(x => x.paper.arxivId === 'm2')!;
    expect(m1.signals.authors).toBe(1);
    expect(m2.signals.authors).toBe(0);
    expect(m1.score).toBeGreaterThan(m2.score);
  });
});

describe('SimilarityIndex — signature memoisation hint', () => {
  it('changes signature when paper set changes', () => {
    const a = new SimilarityIndex([mkPaper({ arxivId: '1', title: 'x' })]);
    const b = new SimilarityIndex([mkPaper({ arxivId: '1', title: 'x' }), mkPaper({ arxivId: '2', title: 'y' })]);
    expect(a.signature).not.toBe(b.signature);
  });

  it('same paper set in different order → same signature', () => {
    const p1 = mkPaper({ arxivId: '1', title: 'x' });
    const p2 = mkPaper({ arxivId: '2', title: 'y' });
    expect(new SimilarityIndex([p1, p2]).signature)
      .toBe(new SimilarityIndex([p2, p1]).signature);
  });
});
