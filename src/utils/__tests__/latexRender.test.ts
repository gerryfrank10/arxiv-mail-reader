import { describe, it, expect } from 'vitest';
import { renderAbstract } from '../latex';

describe('renderAbstract — untrusted HTML', () => {
  it('escapes tags instead of injecting them', () => {
    const out = renderAbstract('<img src=x onerror="alert(1)"> hello');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('escapes script tags', () => {
    const out = renderAbstract('<script>alert(1)</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('escapes bare ampersands', () => {
    expect(renderAbstract('A & B')).toBe('A &amp; B');
  });
});

describe('renderAbstract — LaTeX still works', () => {
  it('renders text commands', () => {
    expect(renderAbstract('a \\textbf{bold} word')).toContain('<strong>bold</strong>');
  });

  it('renders math through KaTeX', () => {
    expect(renderAbstract('$x^2$')).toContain('katex');
  });

  it('unescapes entities before handing math to KaTeX', () => {
    const out = renderAbstract('$a < b$');
    expect(out).toContain('katex');
    expect(out).not.toContain('&amp;lt;');
  });
});
