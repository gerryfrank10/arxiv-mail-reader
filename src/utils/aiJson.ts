/**
 * Robust JSON extraction from noisy AI responses.
 *
 * Local Ollama models and even cloud LLMs love to:
 *   - wrap output in ```json … ``` fences
 *   - prepend "Here is the JSON:" or apologise
 *   - append commentary after the closing brace
 *   - emit smart apostrophes and trailing commas
 *   - just return an empty string when they "give up" on long structured output
 *
 * This helper tolerates all of the above and gives precise error messages
 * so the UI / activity log can show *what* failed (empty? truncated?
 * malformed?) instead of a generic "no JSON".
 */

export class AIEmptyResponseError extends Error {
  constructor() { super('AI returned an empty response'); this.name = 'AIEmptyResponseError'; }
}

export class AITruncatedJsonError extends Error {
  constructor(public readonly partial: string) {
    super(`AI JSON appears truncated (got ${partial.length} chars, no matching closing bracket)`);
    this.name = 'AITruncatedJsonError';
  }
}

export class AIMalformedJsonError extends Error {
  constructor(public readonly preview: string, parseErr: string) {
    super(`AI JSON malformed: ${parseErr}. First 160 chars: ${preview.slice(0, 160)}…`);
    this.name = 'AIMalformedJsonError';
  }
}

/**
 * Extract a top-level JSON value of the requested kind from a noisy
 * AI response. Throws an AIEmptyResponseError / AITruncatedJsonError /
 * AIMalformedJsonError when extraction fails so callers can react to
 * the specific failure mode (e.g. retry with a smaller batch on empty,
 * surface a helpful message in the UI).
 *
 * @param raw  the AI's raw text output
 * @param kind 'object' to extract a `{ … }`, 'array' to extract `[ … ]`
 */
export function extractJson<T>(raw: string, kind: 'object' | 'array'): T {
  if (!raw || !raw.trim()) throw new AIEmptyResponseError();

  let text = raw.trim();

  // Strip ```json … ``` or ``` … ``` markdown fences if present
  const fence = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  const openCh  = kind === 'object' ? '{' : '[';
  const closeCh = kind === 'object' ? '}' : ']';

  const start = text.indexOf(openCh);
  if (start < 0) {
    throw new AIMalformedJsonError(text, `no opening ${openCh} found`);
  }

  // Brace-aware scan so a closing bracket inside a string can't fool us.
  let depth = 0;
  let end   = -1;
  let inStr = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape)                       { escape = false; continue; }
    if (ch === '\\' && inStr)         { escape = true;  continue; }
    if (ch === '"')                   { inStr = !inStr; continue; }
    if (inStr)                        continue;
    if (ch === openCh)                depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }

  if (end < 0) {
    throw new AITruncatedJsonError(text.slice(start));
  }

  let body = text.slice(start, end + 1);

  // Common fixups (safe — only touch chars OUTSIDE the JSON's string syntax):
  //  - smart APOSTROPHES → straight apostrophes (smart double-quotes are
  //    left alone because converting them would break legitimate string
  //    contents that contain them).
  //  - trailing commas before }/] (some models emit them).
  body = body
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1');

  try {
    return JSON.parse(body) as T;
  } catch (e) {
    throw new AIMalformedJsonError(body, (e as Error).message);
  }
}

/**
 * Convenience wrapper that converts the structured errors into a
 * user-friendly hint string. Useful where the UI just wants to show
 * one line about what went wrong.
 */
export function describeJsonError(e: unknown): string {
  if (e instanceof AIEmptyResponseError)   return 'Model returned empty — try a larger model, smaller batch, or different temperature.';
  if (e instanceof AITruncatedJsonError)   return 'Response was cut off mid-JSON — raise max_tokens or shrink the batch.';
  if (e instanceof AIMalformedJsonError)   return e.message;
  if (e instanceof Error)                  return e.message;
  return 'Unknown parsing failure.';
}
