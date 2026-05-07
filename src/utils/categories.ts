export const CATEGORY_COLORS: Record<string, string> = {
  'cs.AI':  'bg-blue-900/60 text-blue-300',
  'cs.LG':  'bg-purple-900/60 text-purple-300',
  'cs.CV':  'bg-green-900/60 text-green-300',
  'cs.CL':  'bg-orange-900/60 text-orange-300',
  'cs.NLP': 'bg-yellow-900/60 text-yellow-300',
  'cs.RO':  'bg-red-900/60 text-red-300',
  'cs.SE':  'bg-cyan-900/60 text-cyan-300',
  'cs.PL':  'bg-teal-900/60 text-teal-300',
  'cs.MA':  'bg-indigo-900/60 text-indigo-300',
  'cs.NE':  'bg-pink-900/60 text-pink-300',
  'cs.IR':  'bg-violet-900/60 text-violet-300',
  'cs.SY':  'bg-lime-900/60 text-lime-300',
  'stat.ML':'bg-emerald-900/60 text-emerald-300',
  'default':'bg-slate-700/60 text-slate-300',
};

export const CATEGORY_LABEL: Record<string, string> = {
  'cs.AI':  'Artificial Intelligence',
  'cs.LG':  'Machine Learning',
  'cs.CV':  'Computer Vision',
  'cs.CL':  'Computation and Language',
  'cs.NLP': 'Natural Language Processing',
  'cs.RO':  'Robotics',
  'cs.SE':  'Software Engineering',
  'cs.PL':  'Programming Languages',
  'cs.MA':  'Multiagent Systems',
  'cs.NE':  'Neural and Evolutionary Computing',
  'cs.IR':  'Information Retrieval',
  'cs.SY':  'Systems and Control',
  'stat.ML':'Statistics – Machine Learning',
};

export function getCategoryLabel(cat: string): string {
  return CATEGORY_LABEL[cat] ?? cat;
}

// Colors for light background (used in Dashboard / PaperDetail)
export const CATEGORY_COLORS_LIGHT: Record<string, string> = {
  'cs.AI':  'bg-blue-100 text-blue-700',
  'cs.LG':  'bg-purple-100 text-purple-700',
  'cs.CV':  'bg-green-100 text-green-700',
  'cs.CL':  'bg-orange-100 text-orange-700',
  'cs.NLP': 'bg-yellow-100 text-yellow-700',
  'cs.RO':  'bg-red-100 text-red-700',
  'cs.SE':  'bg-cyan-100 text-cyan-700',
  'cs.PL':  'bg-teal-100 text-teal-700',
  'cs.MA':  'bg-indigo-100 text-indigo-700',
  'cs.NE':  'bg-pink-100 text-pink-700',
  'cs.IR':  'bg-violet-100 text-violet-700',
  'cs.SY':  'bg-lime-100 text-lime-700',
  'stat.ML':'bg-emerald-100 text-emerald-700',
  'default':'bg-slate-100 text-slate-600',
};

export const CHART_COLORS = [
  '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b',
  '#ef4444', '#06b6d4', '#ec4899', '#84cc16',
  '#6366f1', '#14b8a6', '#f97316', '#a855f7',
];
