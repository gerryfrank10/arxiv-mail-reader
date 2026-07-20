import { Paper } from '../types';

// ─────────────────────────────────────────────────────────────────────────
// Conference detection from arXiv comments
//
// arXiv's `comments` field is free-text, but authors commonly include the
// venue: "Accepted at NeurIPS 2024", "Published in CVPR 2024", "ICLR 2024
// spotlight", "10 pages, ACL 2024", etc. This module parses those patterns
// and groups papers by conference.
// ─────────────────────────────────────────────────────────────────────────

export interface ConferenceInfo {
  /** Normalised conference key, e.g. "neurips", "cvpr", "iclr" */
  key: string;
  /** Display name, e.g. "NeurIPS", "CVPR", "ICLR" */
  name: string;
  /** Year extracted from the comment, if present */
  year: number | null;
  /** Whether the paper was accepted (vs just submitted/under review) */
  accepted: boolean;
  /** Normalised venue type */
  type: 'conference' | 'workshop' | 'journal';
  /** The original comment text for reference */
  rawComment: string;
  /** Short description of the venue */
  about: string;
}

// Known ML/AI/CV/NLP conferences with their canonical names and regex patterns.
// The regex matches case-insensitively and allows optional year suffix.
const CONFERENCES: Array<{ key: string; name: string; patterns: RegExp[]; about: string }> = [
  // Top-tier ML/AI
  { key: 'neurips', name: 'NeurIPS',  patterns: [/neurips|nips/i],
    about: 'Neural Information Processing Systems — the premier ML/AI conference since 1987, covering deep learning, optimization, and theoretical foundations.' },
  { key: 'icml',    name: 'ICML',     patterns: [/icml/i],
    about: 'International Conference on Machine Learning — top venue for ML algorithms, theory, and applications.' },
  { key: 'iclr',    name: 'ICLR',     patterns: [/iclr/i],
    about: 'International Conference on Learning Representations — focused on deep learning, representation learning, and neural network architectures.' },
  { key: 'aaai',    name: 'AAAI',     patterns: [/aaai/i],
    about: 'AAAI Conference on Artificial Intelligence — broad AI coverage: reasoning, knowledge representation, planning, and multi-agent systems.' },
  { key: 'ijcai',   name: 'IJCAI',    patterns: [/ijcai/i],
    about: 'International Joint Conference on Artificial Intelligence — one of the oldest AI conferences, covering the full breadth of AI research.' },
  { key: 'uai',     name: 'UAI',      patterns: [/\buai\b/i],
    about: 'Conference on Uncertainty in Artificial Intelligence — probabilistic reasoning, Bayesian methods, and decision-making under uncertainty.' },
  { key: 'aistats', name: 'AISTATS',  patterns: [/aistats/i],
    about: 'International Conference on Artificial Intelligence and Statistics — statistical learning, probabilistic models, and their intersections with AI.' },
  // Computer Vision
  { key: 'cvpr',   name: 'CVPR',   patterns: [/cvpr/i],
    about: 'IEEE/CVF Conference on Computer Vision and Pattern Recognition — the leading computer vision conference.' },
  { key: 'iccv',   name: 'ICCV',   patterns: [/iccv/i],
    about: 'International Conference on Computer Vision — biennial top-tier vision conference covering 3D vision, recognition, and generation.' },
  { key: 'eccv',   name: 'ECCV',   patterns: [/eccv/i],
    about: 'European Conference on Computer Vision — biennial, second only to CVPR in prestige for vision research.' },
  { key: 'wacv',   name: 'WACV',   patterns: [/wacv/i],
    about: 'Winter Conference on Applications of Computer Vision — applied vision: surveillance, autonomous driving, medical imaging.' },
  { key: 'bmvc',   name: 'BMVC',   patterns: [/bmvc/i],
    about: 'British Machine Vision Conference — computer vision with a UK and European community focus.' },
  { key: '3dv',    name: '3DV',    patterns: [/\b3dv\b/i],
    about: 'International Conference on 3D Vision — 3D reconstruction, point clouds, neural radiance fields, and SLAM.' },
  // NLP / CL
  { key: 'acl',    name: 'ACL',    patterns: [/\bacl\b/i],
    about: 'Annual Meeting of the Association for Computational Linguistics — the flagship NLP conference.' },
  { key: 'emnlp',  name: 'EMNLP',  patterns: [/emnlp/i],
    about: 'Conference on Empirical Methods in Natural Language Processing — NLP with an empirical/experimental focus.' },
  { key: 'naacl',  name: 'NAACL',  patterns: [/naacl/i],
    about: 'Conference of the North American Chapter of the Association for Computational Linguistics.' },
  { key: 'coling', name: 'COLING', patterns: [/coling/i],
    about: 'International Conference on Computational Linguistics — biennial, covering theoretical and applied NLP.' },
  { key: 'tacl',   name: 'TACL',   patterns: [/tacl/i],
    about: 'Transactions of the Association for Computational Linguistics — open-access NLP journal with conference-level review.' },
  // IR / Web / Data Mining
  { key: 'sigir',  name: 'SIGIR',  patterns: [/sigir/i],
    about: 'ACM SIGIR Conference on Research and Development in Information Retrieval — the top IR/search conference.' },
  { key: 'www',    name: 'WWW',    patterns: [/\bwww\b/i],
    about: 'The Web Conference — web science, search, social networks, and web-scale data mining.' },
  { key: 'kdd',    name: 'KDD',    patterns: [/kdd/i],
    about: 'ACM SIGKDD Conference on Knowledge Discovery and Data Mining — the premier data mining conference.' },
  { key: 'wsdm',   name: 'WSDM',   patterns: [/wsdm/i],
    about: 'Web Search and Data Mining — web-scale search, ranking, and data mining research.' },
  { key: 'recsys', name: 'RecSys', patterns: [/recsys/i],
    about: 'ACM Conference on Recommender Systems — the leading venue for recommendation algorithms and evaluation.' },
  { key: 'cikm',   name: 'CIKM',   patterns: [/cikm/i],
    about: 'ACM International Conference on Information and Knowledge Management — bridging databases, IR, and knowledge management.' },
  // Robotics
  { key: 'icra',   name: 'ICRA',   patterns: [/icra/i],
    about: 'IEEE International Conference on Robotics and Automation — the largest robotics conference.' },
  { key: 'iros',   name: 'IROS',   patterns: [/iros/i],
    about: 'IEEE/RSJ International Conference on Intelligent Robots and Systems — robotics with a systems focus.' },
  { key: 'rss',    name: 'RSS',    patterns: [/\brss\b/i],
    about: 'Robotics: Science and Systems — selective, high-impact robotics research conference.' },
  { key: 'corl',   name: 'CoRL',   patterns: [/corl/i],
    about: 'Conference on Robot Learning — learning-based robotics: RL, imitation learning, and manipulation.' },
  // Graphics / Systems / Security
  { key: 'siggraph', name: 'SIGGRAPH', patterns: [/siggraph/i],
    about: 'ACM SIGGRAPH — the premier computer graphics and interactive techniques conference.' },
  { key: 'sosp',   name: 'SOSP',   patterns: [/sosp/i],
    about: 'ACM Symposium on Operating Systems Principles — top-tier systems research, biennial.' },
  { key: 'osdi',   name: 'OSDI',   patterns: [/osdi/i],
    about: 'USENIX Symposium on Operating Systems Design and Implementation — the other top-tier systems venue.' },
  { key: 's&p',    name: 'S&P',    patterns: [/s\s?&\s?p|ieee\s?sp/i],
    about: 'IEEE Symposium on Security and Privacy — the top computer security conference.' },
  { key: 'usenix', name: 'USENIX', patterns: [/usenix/i],
    about: 'USENIX Security Symposium — top-tier security research alongside IEEE S&P.' },
  { key: 'ndss',   name: 'NDSS',   patterns: [/ndss/i],
    about: 'Network and Distributed System Security Symposium — network security and protocols.' },
  { key: 'ccs',    name: 'CCS',    patterns: [/\bccs\b/i],
    about: 'ACM Conference on Computer and Communications Security — top-tier security research.' },
  // Other
  { key: 'icassp', name: 'ICASSP', patterns: [/icassp/i],
    about: 'IEEE International Conference on Acoustics, Speech and Signal Processing — the largest signal processing conference.' },
  { key: 'intersem', name: 'InterpretML', patterns: [/interpret\s?ml/i],
    about: 'Interpretable ML workshop — model interpretability and explainability research.' },
];

// Journal names (non-conference venues)
const JOURNALS: Array<{ key: string; name: string; patterns: RegExp[]; about: string }> = [
  { key: 'tmlr',    name: 'TMLR',    patterns: [/tmlr/i],
    about: 'Transactions on Machine Learning Research — open-access ML journal with rigorous review, no page limits.' },
  { key: 'jmlr',    name: 'JMLR',    patterns: [/jmlr/i],
    about: 'Journal of Machine Learning Research — prestigious open-access ML journal, conference-level rigor.' },
  { key: 'pami',    name: 'TPAMI',   patterns: [/pami|ieee\s?trans.*pami/i],
    about: 'IEEE Transactions on Pattern Analysis and Machine Intelligence — top computer vision and pattern analysis journal.' },
  { key: 'ijcv',    name: 'IJCV',    patterns: [/\bijcv\b/i],
    about: 'International Journal of Computer Vision — the premier computer vision journal.' },
  { key: 'tACL',    name: 'TACL',    patterns: [/tacl/i],
    about: 'Transactions of the Association for Computational Linguistics — open-access NLP journal with conference-level review.' },
];

// Acceptance indicators
const ACCEPTED_PATTERNS = /accepted|published|appear|appear(?:s|ed|ing)?\s+(?:in|at|to)|to\s+appear|camera[-\s]?ready/i;
const REJECTED_PATTERNS = /reject|under\s+review|submitted/i;

// Year extraction: 4-digit year (19xx/20xx) or 2-digit with apostrophe
function extractYear(text: string): number | null {
  // 4-digit year
  const m4 = text.match(/\b(20\d{2}|19\d{2})\b/);
  if (m4) return parseInt(m4[1], 10);
  return null;
}

/** Detect conference / venue info from a paper's comments field. */
export function detectVenue(paper: Paper): ConferenceInfo | null {
  const comment = (paper.comments ?? '').trim();
  if (!comment) return null;

  // Check for workshop
  const isWorkshop = /workshop/i.test(comment);

  // Check for journal
  let venueMatch: { key: string; name: string; type: 'conference' | 'workshop' | 'journal'; about: string } | null = null;
  for (const j of JOURNALS) {
    if (j.patterns.some(p => p.test(comment))) {
      venueMatch = { key: j.key, name: j.name, type: 'journal', about: j.about };
      break;
    }
  }
  if (!venueMatch) {
    for (const c of CONFERENCES) {
      if (c.patterns.some(p => p.test(comment))) {
        venueMatch = { key: c.key, name: c.name, type: isWorkshop ? 'workshop' : 'conference', about: c.about };
        break;
      }
    }
  }
  if (!venueMatch) return null;

  const year = extractYear(comment);
  const accepted = ACCEPTED_PATTERNS.test(comment) || !REJECTED_PATTERNS.test(comment);

  return {
    key: venueMatch.key,
    name: venueMatch.name,
    year,
    accepted,
    type: venueMatch.type,
    rawComment: comment,
    about: venueMatch.about,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Aggregation helpers
// ─────────────────────────────────────────────────────────────────────────

export interface AuthorStat {
  name: string;
  paperCount: number;
  papers: Paper[];
  /** Most recent paper date */
  lastDate: Date;
  /** Categories this author publishes in */
  categories: string[];
  /** Conferences this author has appeared in (deduplicated) */
  venues: string[];
}

export interface VenueGroup {
  info: ConferenceInfo;
  papers: Paper[];
  /** Unique years seen for this venue */
  years: number[];
}

/** Extract a normalised author name from a string (handles "First Last" and
 *  "Last, First" formats). */
function normaliseAuthor(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** Build author statistics from a list of papers, sorted by paper count. */
export function computeAuthorStats(papers: Paper[]): AuthorStat[] {
  const map = new Map<string, AuthorStat>();

  for (const paper of papers) {
    for (const author of paper.authorList) {
      const name = normaliseAuthor(author);
      if (!name) continue;

      let stat = map.get(name);
      if (!stat) {
        stat = {
          name,
          paperCount: 0,
          papers: [],
          lastDate: paper.digestDate,
          categories: [],
          venues: [],
        };
        map.set(name, stat);
      }

      stat.paperCount++;
      stat.papers.push(paper);

      // Track the most recent date
      if (paper.digestDate > stat.lastDate) stat.lastDate = paper.digestDate;

      // Merge categories
      for (const cat of paper.categories) {
        if (!stat.categories.includes(cat)) stat.categories.push(cat);
      }

      // Merge venues
      const venue = detectVenue(paper);
      if (venue && !stat.venues.includes(venue.name)) {
        stat.venues.push(venue.name);
      }
    }
  }

  const stats = [...map.values()];

  // Sort categories alphabetically within each author
  for (const s of stats) s.categories.sort();

  // Sort by paper count (desc), then by name (asc)
  stats.sort((a, b) => b.paperCount - a.paperCount || a.name.localeCompare(b.name));
  return stats;
}

// ─────────────────────────────────────────────────────────────────────────
// Featured AI researchers — well-known contributors whose papers may appear
// in the user's arXiv digests. Matched case-insensitively against author
// names so they surface as a highlighted card at the top of the Authors tab.
// ─────────────────────────────────────────────────────────────────────────

export interface FeaturedAuthor {
  /** Name to match against paper authorList entries (case-insensitive, substring) */
  matchName: string;
  /** Display name */
  name: string;
  /** Short title / role */
  title: string;
  /** One-line bio */
  bio: string;
  /** Affiliation */
  affiliation: string;
  /** Photo URL (Wikipedia / public) */
  photoUrl: string;
}

export const FEATURED_AUTHORS: FeaturedAuthor[] = [
  {
    matchName: 'yann le cun',
    name: 'Yann LeCun',
    title: 'Turing Award Winner · Father of CNNs',
    bio: 'VP & Chief AI Scientist at Meta. Inventor of convolutional neural networks, pioneer of deep learning and self-supervised learning.',
    affiliation: 'Meta AI · NYU',
    photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Yann_LeCun_2018.jpg/200px-Yann_LeCun_2018.jpg',
  },
  {
    matchName: 'yoshua bengio',
    name: 'Yoshua Bengio',
    title: 'Turing Award Winner · Deep Learning Pioneer',
    bio: 'Founder of Mila, professor at Université de Montréal. Pioneer of sequence-to-sequence learning, attention, and generative models.',
    affiliation: 'Mila · Université de Montréal',
    photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Yoshua_Bengio_2020.jpg/200px-Yoshua_Bengio_2020.jpg',
  },
  {
    matchName: 'geoffrey hinton',
    name: 'Geoffrey Hinton',
    title: 'Turing Award Winner · Godfather of Deep Learning',
    bio: 'Nobel Laureate in Physics (2024). Pioneer of backpropagation, deep belief networks, and the Capsule Network architecture.',
    affiliation: 'University of Toronto · Google',
    photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/22/Geoffrey_Hinton_at_UofT.jpg/200px-Geoffrey_Hinton_at_UofT.jpg',
  },
  {
    matchName: 'andrej karpathy',
    name: 'Andrej Karpathy',
    title: 'Director of AI · Tesla · OpenAI',
    bio: 'Former Director of AI at Tesla, founding member of OpenAI. Known for deep learning tutorials and the CS231n course at Stanford.',
    affiliation: 'Eureka Labs',
    photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/76/Andrej_Karpathy_%28cropped%29.jpg/200px-Andrej_Karpathy_%28cropped%29.jpg',
  },
  {
    matchName: 'fei fei li',
    name: 'Fei-Fei Li',
    title: 'Creator of ImageNet · Stanford HAI',
    bio: 'Creator of ImageNet, the dataset that catalyzed the deep learning revolution. Co-Director of Stanford\'s Institute for Human-Centered AI.',
    affiliation: 'Stanford HAI',
    photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Fei-Fei_Li_2018.jpg/200px-Fei-Fei_Li_2018.jpg',
  },
  {
    matchName: 'kaiming he',
    name: 'Kaiming He',
    title: 'ResNet · Mask R-CNN · MoCo',
    bio: 'Creator of ResNet, one of the most cited papers in computer vision. Pioneer of residual learning, momentum contrast, and Mask R-CNN.',
    affiliation: 'MIT CSAIL',
    photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/Kaiming_He.jpg/200px-Kaiming_He.jpg',
  },
  {
    matchName: 'jürgen schmidhuber',
    name: 'Jürgen Schmidhuber',
    title: 'Father of LSTM · Recurrent Networks',
    bio: 'Inventor of Long Short-Term Memory (LSTM), the foundation of modern sequence modeling before Transformers. Director of IDSIA.',
    affiliation: 'IDSIA · KAUST',
    photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c4/Juergen_Schmidhuber.jpeg/200px-Juergen_Schmidhuber.jpeg',
  },
  {
    matchName: 'ian goodfellow',
    name: 'Ian Goodfellow',
    title: 'Inventor of GANs · Google Brain',
    bio: 'Inventor of Generative Adversarial Networks (GANs). Author of the definitive Deep Learning textbook. Formerly at Apple, Google Brain.',
    affiliation: 'Google DeepMind',
    photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Ian_Goodfellow.jpg/200px-Ian_Goodfellow.jpg',
  },
];

/** Group conference papers by venue key. Returns array sorted by paper count. */
export function groupByVenue(papers: Paper[]): VenueGroup[] {
  const map = new Map<string, VenueGroup>();

  for (const paper of papers) {
    const info = detectVenue(paper);
    if (!info) continue;

    let group = map.get(info.key);
    if (!group) {
      group = {
        info,
        papers: [],
        years: [],
      };
      map.set(info.key, group);
    }

    group.papers.push(paper);
    if (info.year && !group.years.includes(info.year)) {
      group.years.push(info.year);
    }
  }

  const groups = [...map.values()];

  // Sort years descending within each group
  for (const g of groups) g.years.sort((a, b) => b - a);

  // Sort groups by paper count (desc), then by name
  groups.sort((a, b) => b.papers.length - a.papers.length || a.info.name.localeCompare(b.info.name));
  return groups;
}