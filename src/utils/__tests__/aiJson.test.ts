import { describe, it, expect } from 'vitest';
import {
  extractJson,
  describeJsonError,
  AIEmptyResponseError,
  AITruncatedJsonError,
  AIMalformedJsonError,
} from '../aiJson';

describe('extractJson — happy path', () => {
  it('parses a bare object', () => {
    expect(extractJson<{ a: number }>('{"a":1}', 'object')).toEqual({ a: 1 });
  });

  it('parses a bare array', () => {
    expect(extractJson<number[]>('[1,2,3]', 'array')).toEqual([1, 2, 3]);
  });

  it('parses with surrounding whitespace', () => {
    expect(extractJson('  \n  {"k":"v"}  \n  ', 'object')).toEqual({ k: 'v' });
  });
});

describe('extractJson — markdown fences', () => {
  it('strips ```json fences', () => {
    const raw = '```json\n{"a":1}\n```';
    expect(extractJson(raw, 'object')).toEqual({ a: 1 });
  });

  it('strips plain ``` fences', () => {
    const raw = '```\n[1,2]\n```';
    expect(extractJson(raw, 'array')).toEqual([1, 2]);
  });

  it('strips fences with leading "Here is the JSON:" preamble', () => {
    const raw = 'Sure! Here is the JSON:\n```json\n{"ok":true}\n```\nLet me know.';
    expect(extractJson(raw, 'object')).toEqual({ ok: true });
  });
});

describe('extractJson — noisy input', () => {
  it('ignores prose before and after the JSON', () => {
    const raw = 'Thinking step by step… {"x":42} — hope that helps!';
    expect(extractJson(raw, 'object')).toEqual({ x: 42 });
  });

  it('does not get fooled by closing brace inside a string', () => {
    const raw = '{"note":"this } looks like an end but is not","y":7}';
    expect(extractJson<{ note: string; y: number }>(raw, 'object'))
      .toEqual({ note: 'this } looks like an end but is not', y: 7 });
  });

  it('does not get fooled by escaped quotes inside strings', () => {
    const raw = '{"q":"he said \\"hi\\""}';
    expect(extractJson<{ q: string }>(raw, 'object')).toEqual({ q: 'he said "hi"' });
  });

  it('handles nested objects', () => {
    const raw = 'Output: {"outer":{"inner":{"k":1}}}';
    expect(extractJson(raw, 'object')).toEqual({ outer: { inner: { k: 1 } } });
  });
});

describe('extractJson — common fixups', () => {
  it('removes trailing commas before closing brace', () => {
    expect(extractJson('{"a":1,"b":2,}', 'object')).toEqual({ a: 1, b: 2 });
  });

  it('removes trailing commas before closing bracket', () => {
    expect(extractJson('[1,2,3,]', 'array')).toEqual([1, 2, 3]);
  });

  it('converts smart apostrophes inside string values', () => {
    // Smart apostrophes (U+2018 / U+2019) inside a string would still parse
    // as JSON technically — but some models use them as an escape, breaking
    // round-trips. The fixup straightens them to ' so downstream code can
    // do simple string comparisons.
    const out = extractJson<{ q: string }>('{"q":"don’t worry"}', 'object');
    expect(out.q).toBe("don't worry");
  });
});

describe('extractJson — error modes', () => {
  it('throws AIEmptyResponseError for empty string', () => {
    expect(() => extractJson('', 'object')).toThrow(AIEmptyResponseError);
  });

  it('throws AIEmptyResponseError for whitespace-only', () => {
    expect(() => extractJson('   \n\t  ', 'object')).toThrow(AIEmptyResponseError);
  });

  it('throws AIMalformedJsonError when no opening brace at all', () => {
    expect(() => extractJson('just prose, no json here', 'object')).toThrow(AIMalformedJsonError);
  });

  it('throws AITruncatedJsonError when closing brace is missing', () => {
    expect(() => extractJson('{"a":1,"b":[1,2,3', 'object')).toThrow(AITruncatedJsonError);
  });

  it('AITruncatedJsonError carries the partial payload', () => {
    try {
      extractJson('{"a":1', 'object');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AITruncatedJsonError);
      expect((e as AITruncatedJsonError).partial).toBe('{"a":1');
    }
  });

  it('throws AIMalformedJsonError when braces match but JSON.parse fails', () => {
    // Bare identifier (no quotes) — braces balance, but JSON.parse rejects it.
    expect(() => extractJson('{"a": notAString}', 'object')).toThrow(AIMalformedJsonError);
  });
});

describe('describeJsonError', () => {
  it('describes empty', () => {
    expect(describeJsonError(new AIEmptyResponseError())).toMatch(/empty/i);
  });
  it('describes truncated', () => {
    expect(describeJsonError(new AITruncatedJsonError('xxx'))).toMatch(/cut off|max_tokens/i);
  });
  it('describes malformed', () => {
    const err = new AIMalformedJsonError('xxx', 'unexpected token');
    expect(describeJsonError(err)).toMatch(/malformed/i);
  });
  it('handles generic Error', () => {
    expect(describeJsonError(new Error('boom'))).toBe('boom');
  });
  it('handles non-Error values', () => {
    expect(describeJsonError('weird')).toMatch(/unknown/i);
  });
});
