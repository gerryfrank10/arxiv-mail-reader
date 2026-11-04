import katex from 'katex';

function renderKatex(math: string, displayMode: boolean): string {
  try {
    return katex.renderToString(math, { displayMode, throwOnError: false, output: 'html' });
  } catch {
    return math;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export function renderAbstract(text: string): string {
  // Abstract text is untrusted (email bodies, imported metadata). Escape all
  // HTML first so a malicious `<script>`/`<img onerror>` renders as text; the
  // only markup in the output is what we add below (plus KaTeX's own HTML).
  let result = escapeHtml(text);

  // First, clean up plain-text LaTeX artifacts that arXiv abstracts are full
  // of — otherwise they show as literal "80\%" / "data -- such as" and look
  // broken (or even truncated). Done BEFORE math rendering so we operate on
  // the raw text, not on KaTeX-generated HTML. None of these touch the math
  // delimiters ($ \( \[) or the \textbf{}/\emph{} commands handled below.
  result = result
    .replace(/---/g, '—')                      // em dash
    .replace(/--/g, '–')                       // en dash
    .replace(/``/g, '“').replace(/''/g, '”')   // TeX quotes
    .replace(/\\([%&_#])/g, '$1')              // escaped specials: \% \& \_ \#
    .replace(/(?<![$\\])~/g, ' ')              // TeX non-breaking space (not \~)
    .replace(/\\(?:,|;|:|!)/g, ' ');           // TeX spacing macros

  // Display math: \[...\]
  result = result.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => renderKatex(unescapeHtml(m).trim(), true));

  // Inline math: \(...\)
  result = result.replace(/\\\((.+?)\\\)/g, (_, m) => renderKatex(unescapeHtml(m).trim(), false));

  // Dollar math: $...$  (not $$)
  result = result.replace(/(?<!\$)\$([^$\n]+?)\$(?!\$)/g, (_, m) => renderKatex(unescapeHtml(m).trim(), false));

  // LaTeX text commands
  result = result.replace(/\\emph\{([^}]+)\}/g, '<em>$1</em>');
  result = result.replace(/\\textit\{([^}]+)\}/g, '<em>$1</em>');
  result = result.replace(/\\textbf\{([^}]+)\}/g, '<strong>$1</strong>');
  result = result.replace(/\\texttt\{([^}]+)\}/g, '<code class="text-sm font-mono bg-slate-100 px-1 rounded">$1</code>');

  return result;
}
