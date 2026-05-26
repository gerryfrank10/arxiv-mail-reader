import { describe, it, expect } from 'vitest';
import { decodeLatex } from '../latexDecode';

describe('decodeLatex — accents', () => {
  it('decodes umlauts (braced and bare)', () => {
    expect(decodeLatex('G\\"orkem')).toBe('Görkem');
    expect(decodeLatex('G\\"{o}rkem')).toBe('Görkem');
  });

  it("decodes \\'e to é", () => {
    expect(decodeLatex("Andr\\'e")).toBe('André');
  });

  it("decodes braced acute \\'{o} to ó", () => {
    expect(decodeLatex("L\\'{o}pez")).toBe('López');
  });

  it('decodes graves', () => {
    expect(decodeLatex('\\`a')).toBe('à');
  });

  it('decodes circumflex', () => {
    expect(decodeLatex('h\\^{o}tel')).toBe('hôtel');
  });

  it('decodes tilde', () => {
    expect(decodeLatex('Espa\\~na')).toBe('España');
  });

  it('decodes cedilla', () => {
    expect(decodeLatex('Fran\\c{c}ois')).toBe('François');
  });

  it('decodes caron', () => {
    expect(decodeLatex('\\v{S}imek')).toBe('Šimek');
  });
});

describe('decodeLatex — special letters', () => {
  it('decodes braced {\\ss}', () => {
    // {\ss} is the canonical bibtex form — the braces get stripped after.
    expect(decodeLatex('Stra{\\ss}e')).toBe('Straße');
  });

  it('decodes æ and Æ', () => {
    expect(decodeLatex('\\ae \\AE')).toBe('æ Æ');
  });

  it('decodes Polish ł', () => {
    // \L\b requires a non-word-boundary terminator; {} braces both terminate
    // the macro and are subsequently stripped by the final cleanup rule.
    expect(decodeLatex('\\L{}odz')).toBe('Łodz');
  });

  it('decodes Scandinavian ø', () => {
    expect(decodeLatex('\\o{}re')).toBe('øre');
  });
});

describe('decodeLatex — passthrough', () => {
  it('returns plain ASCII unchanged', () => {
    expect(decodeLatex('Plain text with no escapes')).toBe('Plain text with no escapes');
  });

  it('strips stray braces (per the final rule)', () => {
    expect(decodeLatex('{GPT}')).toBe('GPT');
  });

  it('is idempotent on already-decoded unicode', () => {
    expect(decodeLatex('Görkem')).toBe('Görkem');
  });
});
