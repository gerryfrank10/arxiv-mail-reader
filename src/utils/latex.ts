import katex from 'katex';

function renderKatex(math: string, displayMode: boolean): string {
  try {
    return katex.renderToString(math, { displayMode, throwOnError: false, output: 'html' });
  } catch {
    return math;
  }
}

export function renderAbstract(text: string): string {
  let result = text;

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
  result = result.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => renderKatex(m.trim(), true));

  // Inline math: \(...\)
  result = result.replace(/\\\((.+?)\\\)/g, (_, m) => renderKatex(m.trim(), false));

  // Dollar math: $...$  (not $$)
  result = result.replace(/(?<!\$)\$([^$\n]+?)\$(?!\$)/g, (_, m) => renderKatex(m.trim(), false));

  // LaTeX text commands
  result = result.replace(/\\emph\{([^}]+)\}/g, '<em>$1</em>');
  result = result.replace(/\\textit\{([^}]+)\}/g, '<em>$1</em>');
  result = result.replace(/\\textbf\{([^}]+)\}/g, '<strong>$1</strong>');
  result = result.replace(/\\texttt\{([^}]+)\}/g, '<code class="text-sm font-mono bg-slate-100 px-1 rounded">$1</code>');

  return result;
}
