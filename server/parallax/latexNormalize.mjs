// LaTeX -> Unicode normalization for paper metadata display.
//
// arXiv titles/abstracts embed LaTeX math (\ell, \mathbb{R}, $\alpha$,
// superscripts, etc.). The pilot fixture stores raw strings; this module
// converts the common subset to readable Unicode at SERVE time so clients
// never render raw markup. It is deliberately conservative: unknown commands
// are stripped rather than guessed at, so no content is invented.

const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ',
  tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};

const SYMBOLS = {
  ell: 'ℓ', times: '×', div: '÷', pm: '±', mp: '∓', cdot: '·', ldots: '…',
  dots: '…', cdots: '⋯', sim: '∼', simeq: '≃', approx: '≈', equiv: '≡',
  neq: '≠', ne: '≠', leq: '≤', le: '≤', geq: '≥', ge: '≥', ll: '≪', gg: '≫',
  infty: '∞', partial: '∂', nabla: '∇', forall: '∀', exists: '∃',
  in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩',
  setminus: '∖', emptyset: '∅', varnothing: '∅', oplus: '⊕', otimes: '⊗',
  odot: '⊙', perp: '⊥', parallel: '∥', angle: '∠', triangle: '△',
  square: '□', star: '⋆', dagger: '†', ddagger: '‡', bullet: '•',
  circ: '∘', wedge: '∧', vee: '∨', neg: '¬', lnot: '¬',
  rightarrow: '→', to: '→', leftarrow: '←', gets: '←', leftrightarrow: '↔',
  Rightarrow: '⇒', impliesthat: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔',
  iff: '⇔', mapsto: '↦', uparrow: '↑', downarrow: '↓',
  propto: '∝', cong: '≅', sum: '∑', prod: '∏', int: '∫', sqrt: '√',
  langle: '⟨', rangle: '⟩', lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋',
};

const SUPER = { '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','+':'⁺','-':'⁻','=':'⁼','(':'⁽',')':'⁾','n':'ⁿ','i':'ⁱ' };
const SUB   = { '0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉','+':'₊','-':'₋','=':'₌','(':'₍',')':'₎','a':'ₐ','e':'ₑ','h':'ₕ','i':'ᵢ','j':'ⱼ','k':'ₖ','l':'ₗ','m':'ₘ','n':'ₙ','o':'ₒ','p':'ₚ','r':'ᵣ','s':'ₛ','t':'ₜ','u':'ᵤ','v':'ᵥ','x':'ₓ' };

const ACCENTS = { hat: '^', bar: '‾', tilde: '~', vec: '→' };

function mapCharSet(body, table) {
  if (!body) return '';
  return [...body].map(ch => table[ch] ?? ch).join('');
}

// \mathbb{R} / \mathcal{X} / \mathrm{d} etc. -> best Unicode effort.
const BLACKBOARD = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', P: 'ℙ', E: '𝔼', F: '𝔽', H: 'ℍ' };

function replaceCommand(src, name, arg, out) {
  const single = arg && !/^[a-zA-Z]+$/.test(arg) ? arg.replace(/^[{}]|[{}]$/g, '') : arg;
  return src
    .replaceAll(`\\${name}{${arg}}`, out)
    .replaceAll(`\\${name} ${arg || ''}`, out)
    .replaceAll(`\\${name}`, out);
}

export function latexToUnicode(input) {
  if (typeof input !== 'string') return input;
  let s = input;

  // Ligature and spacing hygiene from arXiv exports.
  s = s.replace(/\ufb00/g, 'ff').replace(/\ufb01/g, 'fi').replace(/\ufb02/g, 'fl')
       .replace(/\ufb03/g, 'ffi').replace(/\ufb04/g, 'ffl');
  s = s.replace(/[\u200b\u200a\ufeff]/g, '');
  s = s.replace(/``|''/g, m => (m === '``' ? '“' : '”')).replace(/([^\\])'/g, '$1’');

  // Accents: \hat{x} -> x̄ (approximate; keeps the letter readable).
  for (const [cmd, mark] of Object.entries(ACCENTS)) {
    s = s.replace(new RegExp(`\\\\${cmd}\\{([A-Za-z])\\}`, 'g'), (_m, letter) => `${letter}${mark}`);
  }

  // Blackboard / script alphabets.
  for (const [letter, glyph] of Object.entries(BLACKBOARD)) {
    s = replaceCommand(s, 'mathbb', letter, glyph);
  }
  s = s.replace(/\\mathcal\{([A-Za-z])\}/g, (_m, l) => l);

  // Greek + symbols. Longest names first to avoid \in matching inside \infty.
  const names = [...Object.keys(SYMBOLS), ...Object.keys(GREEK)].sort((a, b) => b.length - a.length);
  for (const name of names) {
    const glyph = SYMBOLS[name] ?? GREEK[name];
    s = s.replace(new RegExp(`\\\\${name}(?![a-zA-Z])`, 'g'), glyph);
  }

  // Fractions: \frac{a}{b} -> a/b
  s = s.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2');

  // Exponents and indices: x^{2} / x^2 / x_{i} / x_i
  s = s.replace(/\^\{([^{}]+)\}/g, (_m, body) => mapCharSet(body, SUPER));
  s = s.replace(/\^([A-Za-z0-9+\-=()])/g, (_m, ch) => SUPER[ch] ?? ch);
  s = s.replace(/_\{([^{}]+)\}/g, (_m, body) => mapCharSet(body, SUB));
  s = s.replace(/_([A-Za-z0-9+\-=()])/g, (_m, ch) => SUB[ch] ?? ch);

  // Escaped literals and spacing commands.
  s = s.replace(/\\([%&$#_{}])/g, '$1');
  s = s.replace(/\\[,;!>]/g, ' ').replace(/\\ /g, ' ');
  s = s.replace(/~/g, ' ');

  // Inline/display math delimiters (content already converted).
  s = s.replace(/\$\$/g, ' ').replace(/\$/g, '');

  // Unknown leftovers: drop backslash commands like \citep-style noise,
  // but never drop the surrounding words.
  s = s.replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?/g, ' ');

  // Tidy braces that survived (plain grouping): {x} -> x
  s = s.replace(/[{}]/g, '');
  s = s.replace(/[ \t]{2,}/g, ' ');
  s = s.replace(/\s+([,.;:!?])/g, '$1');
  s = s.trim();

  return s;
}

// Normalize one fixture paper record in place (returns a new object).
export function normalizePaper(paper) {
  if (!paper || typeof paper !== 'object') return paper;
  const out = { ...paper };
  for (const key of ['title', 'abstractExcerpt']) {
    if (typeof out[key] === 'string') out[key] = latexToUnicode(out[key]);
  }
  if (Array.isArray(out.authors)) {
    out.authors = out.authors.map(a => latexToUnicode(String(a)));
  }
  return out;
}