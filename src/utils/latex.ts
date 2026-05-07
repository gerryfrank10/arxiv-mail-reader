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

  // Escape remaining backslash sequences that aren't LaTeX we handle
  return result;
}
