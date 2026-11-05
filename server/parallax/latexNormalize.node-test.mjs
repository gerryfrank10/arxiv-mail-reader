import test from 'node:test';
import assert from 'node:assert/strict';
import { latexToUnicode, normalizePaper } from './latexNormalize.mjs';

test('latex commands convert to unicode', () => {
  assert.equal(latexToUnicode(String.raw`An $\ell^1$-Plug-and-Play Approach`), 'An ℓ¹-Plug-and-Play Approach');
  assert.equal(latexToUnicode(String.raw`accuracy of $\sim 95\%$`), 'accuracy of ∼ 95%');
  assert.equal(latexToUnicode(String.raw`$\mathbb{R}^n$ space`), 'ℝⁿ space');
  assert.equal(latexToUnicode(String.raw`rate is $\alpha + \beta_{i}$`), 'rate is α + βᵢ');
  assert.equal(latexToUnicode(String.raw`loss $\times 2$`), 'loss × 2');
});

test('ligatures and stray delimiters are cleaned', () => {
  assert.equal(latexToUnicode('the ﬁeld of ﬂow'), 'the field of flow');
  assert.equal(latexToUnicode('spurious  $  dollars'), 'spurious dollars');
  assert.equal(latexToUnicode('double  spaces   remain'), 'double spaces remain');
});

test('unknown commands are stripped; brace content is kept', () => {
  const out = latexToUnicode(String.raw`we use \citep{ref} and \unknowncmd here`);
  assert.equal(out, 'we use ref and here');
});

test('normalizePaper touches titles, abstracts, authors only', () => {
  const paper = {
    id: '1',
    arxivId: '2401.00275',
    title: String.raw`An $\ell^1$ approach`,
    abstractExcerpt: String.raw`gives $\sim$ results`,
    authors: ['A. Fi{}rst'],
    categories: ['cs.LG'],
    submittedAt: null,
    source: 'arXiv',
    sourceUrl: 'https://arxiv.org/abs/2401.00275',
  };
  const out = normalizePaper(paper);
  assert.equal(out.title, 'An ℓ¹ approach');
  assert.equal(out.abstractExcerpt, 'gives ∼ results');
  assert.deepEqual(out.authors, ['A. First']);
  assert.equal(out.arxivId, paper.arxivId); // untouched fields pass through
  assert.notEqual(out, paper); // new object; fixture file stays intact
});
