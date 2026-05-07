import { Paper } from '../types';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'for', 'on', 'and', 'is', 'to', 'with',
  'by', 'as', 'at', 'or', 'from', 'are', 'we', 'our', 'that', 'this',
  'via', 'into', 'can', 'be', 'it', 'its', 'not', 'also', 'which',
  'using', 'used', 'based', 'show', 'paper', 'propose', 'presents',
  'study', 'work', 'approach', 'method', 'model', 'data', 'results',
  'task', 'tasks', 'performance', 'both', 'while', 'their', 'they',
  'these', 'such', 'have', 'has', 'more', 'new', 'between', 'than',
  'over', 'under', 'high', 'low', 'large', 'small', 'deep', 'wide',
]);

function extractWords(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/\W+/).filter(w => w.length > 3 && !STOP_WORDS.has(w))
  );
}

export interface RelatedPaper {
  paper: Paper;
  score: number;
  reasons: string[];
}

export function getRelatedPapers(paper: Paper, allPapers: Paper[], limit = 6): RelatedPaper[] {
  const tWords = extractWords(paper.title);
  const authorSet = new Set(paper.authorList.map(a => a.toLowerCase().trim()));
  const catSet = new Set(paper.categories);
  const primaryCat = paper.categories[0];

  return allPapers
    .filter(p => p.id !== paper.id)
    .map(p => {
      let score = 0;
      const reasons: string[] = [];

      if (primaryCat && p.categories[0] === primaryCat) {
        score += 5;
        reasons.push(`Same field (${primaryCat})`);
      }

      let sharedCats = 0;
      for (const cat of p.categories) {
        if (catSet.has(cat) && cat !== p.categories[0]) sharedCats++;
      }
      if (sharedCats) {
        score += sharedCats * 2;
        reasons.push(`${sharedCats} shared categor${sharedCats > 1 ? 'ies' : 'y'}`);
      }

      let sharedAuthors = 0;
      for (const author of p.authorList) {
        if (authorSet.has(author.toLowerCase().trim())) sharedAuthors++;
      }
      if (sharedAuthors) {
        score += sharedAuthors * 4;
        reasons.push(`${sharedAuthors} shared author${sharedAuthors > 1 ? 's' : ''}`);
      }

      const pWords = extractWords(p.title);
      let overlap = 0;
      for (const w of pWords) { if (tWords.has(w)) overlap++; }
      if (overlap) {
        score += overlap;
        reasons.push('Related topic');
      }

      return { paper: p, score, reasons: [...new Set(reasons)] };
    })
    .filter(x => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
