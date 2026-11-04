// Works out which company or research lab wrote a paper, from the text at the
// top of its PDF (title block and author affiliations, before the abstract).
//
// arXiv listings and digest emails don't carry affiliations, so this reads the
// first page. Matching is deliberately conservative: only well-known names,
// and only in the header, so a paper that merely cites "Google Scholar" or
// mentions "meta-learning" isn't attributed to a company.

const ORGANIZATIONS = [
  { name: 'Google DeepMind', re: /google\s*deep\s*mind|\bdeepmind\b/i },
  { name: 'Google',          re: /\bgoogle(?!\s*scholar)\b(?!\s*(?:docs|drive|search))/i },
  { name: 'NVIDIA',          re: /\bnvidia\b/i },
  { name: 'Meta',            re: /\bmeta\s+(?:ai|fair|platforms|reality\s+labs|superintelligence)\b|\bfacebook\s+(?:ai|research)\b|\bfacebook\b/i },
  { name: 'Microsoft',       re: /\bmicrosoft\b/i },
  { name: 'OpenAI',          re: /\bopenai\b/i },
  { name: 'Anthropic',       re: /\banthropic\b/i },
  { name: 'Apple',           re: /\bapple\s+(?:inc|machine\s+learning|research|ai)\b/i },
  { name: 'Amazon',          re: /\bamazon\b|\baws\s+ai\b/i },
  { name: 'IBM Research',    re: /\bibm\s+research\b|\bibm\s+t\.?\s*j\.?\s*watson\b/i },
  { name: 'Alibaba',         re: /\balibaba\b|\bqwen\s+team\b|\bdamo\s+academy\b/i },
  { name: 'ByteDance',       re: /\bbytedance\b/i },
  { name: 'Tencent',         re: /\btencent\b/i },
  { name: 'Baidu',           re: /\bbaidu\b/i },
  { name: 'DeepSeek',        re: /\bdeepseek\b/i },
  { name: 'Mistral AI',      re: /\bmistral\s+ai\b/i },
  { name: 'Salesforce',      re: /\bsalesforce\b/i },
  { name: 'Adobe',           re: /\badobe\b/i },
  { name: 'Intel',           re: /\bintel\s+(?:labs|corporation|corp\.?)\b/i },
  { name: 'Samsung',         re: /\bsamsung\b/i },
  { name: 'Huawei',          re: /\bhuawei\b/i },
  { name: 'Hugging Face',    re: /\bhugging\s*face\b/i },
  { name: 'Cohere',          re: /\bcohere\b(?:\s+ai|\s+inc)?/i },
  { name: 'xAI',             re: /\bx\.?ai\b/i },
  { name: 'Allen Institute for AI', re: /\ballen\s+institute\s+for\s+ai\b|\bai2\b/i },
  { name: 'Sony',            re: /\bsony\s+(?:ai|group|corporation)\b/i },
];

// Everything before the abstract (or the first few thousand characters) is the
// header. Body text is ignored on purpose.
const HEADER_CHARS = 4000;

function headerOf(text) {
  const s = String(text ?? '');
  const m = s.search(/\babstract\b/i);
  const end = m > 0 && m < HEADER_CHARS ? m : Math.min(s.length, HEADER_CHARS);
  return s.slice(0, end);
}

/** Returns the company/lab name found first in the header, or null. */
export function detectOrganization(text) {
  const header = headerOf(text);
  let best = null;
  for (const org of ORGANIZATIONS) {
    const m = org.re.exec(header);
    if (m && (best === null || m.index < best.index)) best = { name: org.name, index: m.index };
  }
  return best ? best.name : null;
}
