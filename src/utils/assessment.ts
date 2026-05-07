import { Paper } from '../types';

export type AssessmentLabel = 'In Depth' | 'Notable' | 'Standard' | 'Brief';

export interface Assessment {
  label: AssessmentLabel;
  score: number;
  signals: string[];
  wordCount: number;
}

const SIGNALS: Array<[string, string]> = [
  ['novel',              'Novel contribution'],
  ['state-of-the-art',  'State-of-the-art'],
  ['state of the art',  'State-of-the-art'],
  ['outperform',        'Outperforms baselines'],
  ['benchmark',         'Benchmark evaluation'],
  ['large-scale',       'Large-scale study'],
  ['large scale',       'Large-scale study'],
  ['theoretical',       'Theoretical analysis'],
  ['provably',          'Provable guarantees'],
  ['theorem',           'Formal theorem'],
  ['empirically',       'Empirical study'],
  ['significantly',     'Significant improvement'],
  ['superior',          'Superior performance'],
  ['dataset',           'Dataset contribution'],
  ['open-source',       'Open source release'],
  ['open source',       'Open source release'],
  ['real-world',        'Real-world application'],
  ['deployed',          'Deployed system'],
];

export function computeAssessment(paper: Paper): Assessment {
  const abstract = paper.abstract.toLowerCase();
  const wordCount = paper.abstract.split(/\s+/).filter(Boolean).length;

  const lengthScore = Math.min(35, Math.floor(wordCount / 8));
  const authorScore = Math.min(20, paper.authorList.length * 3);
  const catScore    = Math.min(15, (paper.categories.length - 1) * 5);

  const seen = new Set<string>();
  const signals: string[] = [];
  for (const [term, label] of SIGNALS) {
    if (abstract.includes(term) && !seen.has(label)) {
      seen.add(label);
      signals.push(label);
    }
  }
  const signalScore = Math.min(30, signals.length * 5);

  const score = Math.min(100, lengthScore + authorScore + catScore + signalScore);

  let label: AssessmentLabel;
  if (score >= 65)      label = 'In Depth';
  else if (score >= 42) label = 'Notable';
  else if (score >= 22) label = 'Standard';
  else                  label = 'Brief';

  return { label, score, signals: signals.slice(0, 5), wordCount };
}

export const ASSESSMENT_RING: Record<AssessmentLabel, string> = {
  'In Depth': 'text-emerald-600',
  'Notable':  'text-blue-600',
  'Standard': 'text-slate-500',
  'Brief':    'text-gray-400',
};

export const ASSESSMENT_BADGE: Record<AssessmentLabel, string> = {
  'In Depth': 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  'Notable':  'bg-blue-100 text-blue-700 border border-blue-200',
  'Standard': 'bg-slate-100 text-slate-600 border border-slate-200',
  'Brief':    'bg-gray-100 text-gray-500 border border-gray-200',
};

export const ASSESSMENT_BAR: Record<AssessmentLabel, string> = {
  'In Depth': 'bg-emerald-500',
  'Notable':  'bg-blue-500',
  'Standard': 'bg-slate-400',
  'Brief':    'bg-gray-400',
};
