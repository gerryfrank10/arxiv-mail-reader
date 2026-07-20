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
    about: 'Conference on Neural Information Processing Systems. Annual since 1987, held every December. Along with ICML and ICLR, it is one of the three primary conferences in machine learning and AI. Covers deep learning, optimization, statistics, and computational neuroscience.' },
  { key: 'icml',    name: 'ICML',     patterns: [/icml/i],
    about: 'International Conference on Machine Learning. The oldest ML conference (since 1980), held annually in July. Organized by the International Machine Learning Society (IMLS). Proceedings are open-access via PMLR. One of the three primary ML/AI conferences alongside NeurIPS and ICLR.' },
  { key: 'iclr',    name: 'ICLR',     patterns: [/iclr/i],
    about: 'International Conference on Learning Representations. Founded in 2013 by Yann LeCun and Yoshua Bengio. Held annually in late April or May. Known for its open peer-review process on OpenReview. One of the three primary ML/AI conferences, focused on deep learning and representation learning.' },
  { key: 'aaai',    name: 'AAAI',     patterns: [/aaai/i],
    about: 'AAAI Conference on Artificial Intelligence. Annual since 1980, organized by the Association for the Advancement of Artificial Intelligence. Broad AI scope: reasoning, knowledge representation, planning, multi-agent systems, and applied AI.' },
  { key: 'ijcai',   name: 'IJCAI',    patterns: [/ijcai/i],
    about: 'International Joint Conference on Artificial Intelligence. Biennial since 1969, one of the oldest AI conferences. Covers the full breadth of AI: symbolic reasoning, machine learning, knowledge representation, and autonomous agents.' },
  { key: 'uai',     name: 'UAI',      patterns: [/\buai\b/i],
    about: 'Conference on Uncertainty in Artificial Intelligence. Annual since 1985. Focused on probabilistic reasoning, Bayesian methods, causal inference, and decision-making under uncertainty.' },
  { key: 'aistats', name: 'AISTATS',  patterns: [/aistats/i],
    about: 'International Conference on Artificial Intelligence and Statistics. Annual since 1985. Bridges statistical theory and AI practice — statistical learning, probabilistic models, and their intersections.' },
  // Computer Vision
  { key: 'cvpr',   name: 'CVPR',   patterns: [/cvpr/i],
    about: 'IEEE/CVF Conference on Computer Vision and Pattern Recognition. Annual since 1983, the premier computer vision conference. Co-sponsored by IEEE Computer Society and the Computer Vision Foundation (open access since 2012). Topics: object recognition, segmentation, 3D reconstruction, and deep learning for vision.' },
  { key: 'iccv',   name: 'ICCV',   patterns: [/iccv/i],
    about: 'International Conference on Computer Vision. Biennial since 1987, the highest-impact vision conference alongside CVPR. Covers 3D vision, scene understanding, video analysis, and generative models.' },
  { key: 'eccv',   name: 'ECCV',   patterns: [/eccv/i],
    about: 'European Conference on Computer Vision. Biennial since 1990, second only to CVPR in prestige. Organized by ECCV in even years (alternating with ICCV in odd years). Strong European research community.' },
  { key: 'wacv',   name: 'WACV',   patterns: [/wacv/i],
    about: 'Winter Conference on Applications of Computer Vision. Annual, IEEE-sponsored. Focused on applied vision: surveillance, autonomous driving, medical imaging, and industrial inspection.' },
  { key: 'bmvc',   name: 'BMVC',   patterns: [/bmvc/i],
    about: 'British Machine Vision Conference. Annual, organized by the British Machine Vision Association. Computer vision with a UK and European community focus.' },
  { key: '3dv',    name: '3DV',    patterns: [/\b3dv\b/i],
    about: 'International Conference on 3D Vision. Annual since 2013. 3D reconstruction, point clouds, neural radiance fields, SLAM, and depth estimation.' },
  // NLP / CL
  { key: 'acl',    name: 'ACL',    patterns: [/\bacl\b/i],
    about: 'Annual Meeting of the Association for Computational Linguistics. The flagship NLP conference, organized by ACL (founded 1962). Rotates between Europe, North America, and Asia. The primary venue for NLP research alongside EMNLP.' },
  { key: 'emnlp',  name: 'EMNLP',  patterns: [/emnlp/i],
    about: 'Conference on Empirical Methods in Natural Language Processing. Annual, organized by ACL. The second premier NLP conference alongside ACL, with a focus on empirical and experimental NLP methods — LLMs, translation, summarization, and information extraction.' },
  { key: 'naacl',  name: 'NAACL',  patterns: [/naacl/i],
    about: 'Conference of the North American Chapter of the Association for Computational Linguistics. Annual NLP conference focused on the North American research community.' },
  { key: 'coling', name: 'COLING', patterns: [/coling/i],
    about: 'International Conference on Computational Linguistics. Biennial since 1965, one of the oldest NLP conferences. Covers theoretical and applied computational linguistics.' },
  { key: 'tacl',   name: 'TACL',   patterns: [/tacl/i],
    about: 'Transactions of the Association for Computational Linguistics. Open-access NLP journal with conference-level peer review. Papers presented at ACL or EMNLP.' },
  // IR / Web / Data Mining
  { key: 'sigir',  name: 'SIGIR',  patterns: [/sigir/i],
    about: 'ACM SIGIR Conference on Research and Development in Information Retrieval. Annual since 1977, the premier information retrieval and search conference. Topics: ranking, recommendation, query understanding, and web search.' },
  { key: 'www',    name: 'WWW',    patterns: [/\bwww\b/i],
    about: 'The Web Conference. Annual since 1994, organized by ACM. Web science, search, social networks, web-scale data mining, and internet measurement.' },
  { key: 'kdd',    name: 'KDD',    patterns: [/kdd/i],
    about: 'ACM SIGKDD Conference on Knowledge Discovery and Data Mining. Annual since 1995, the premier data mining conference. Topics: large-scale mining, graph analytics, recommender systems, and applied ML.' },
  { key: 'wsdm',   name: 'WSDM',   patterns: [/wsdm/i],
    about: 'Web Search and Data Mining. Annual since 2008, ACM-sponsored. Web-scale search, ranking, advertising, and data mining research.' },
  { key: 'recsys', name: 'RecSys', patterns: [/recsys/i],
    about: 'ACM Conference on Recommender Systems. Annual since 2007, the leading venue for recommendation algorithms, evaluation metrics, and real-world deployment.' },
  { key: 'cikm',   name: 'CIKM',   patterns: [/cikm/i],
    about: 'ACM International Conference on Information and Knowledge Management. Annual since 1992. Bridges databases, IR, and knowledge management.' },
  // Robotics
  { key: 'icra',   name: 'ICRA',   patterns: [/icra/i],
    about: 'IEEE International Conference on Robotics and Automation. Annual since 1984, the largest robotics conference. Manipulation, locomotion, SLAM, perception, and human-robot interaction.' },
  { key: 'iros',   name: 'IROS',   patterns: [/iros/i],
    about: 'IEEE/RSJ International Conference on Intelligent Robots and Systems. Annual since 1988. Robotics with a systems focus: autonomous navigation, grasping, and robot learning.' },
  { key: 'rss',    name: 'RSS',    patterns: [/\brss\b/i],
    about: 'Robotics: Science and Systems. Annual since 2005, highly selective. Top-impact robotics research covering theory, systems, and applications.' },
  { key: 'corl',   name: 'CoRL',   patterns: [/corl/i],
    about: 'Conference on Robot Learning. Annual since 2017. Learning-based robotics: reinforcement learning, imitation learning, manipulation, and sim-to-real transfer.' },
  // Graphics / Systems / Security
  { key: 'siggraph', name: 'SIGGRAPH', patterns: [/siggraph/i],
    about: 'ACM SIGGRAPH. Annual since 1974, the premier computer graphics and interactive techniques conference. Rendering, animation, VR/AR, and neural rendering.' },
  { key: 'sosp',   name: 'SOSP',   patterns: [/sosp/i],
    about: 'ACM Symposium on Operating Systems Principles. Biennial since 1967, one of the two top-tier systems venues (with OSDI). Distributed systems, storage, and OS architecture.' },
  { key: 'osdi',   name: 'OSDI',   patterns: [/osdi/i],
    about: 'USENIX Symposium on Operating Systems Design and Implementation. Biennial since 1994, the other top-tier systems venue. Distributed systems, virtualization, and cloud infrastructure.' },
  { key: 's&p',    name: 'S&P',    patterns: [/s\s?&\s?p|ieee\s?sp/i],
    about: 'IEEE Symposium on Security and Privacy. Annual since 1980, the top computer security conference. Covers systems security, cryptography, privacy, and adversarial ML.' },
  { key: 'usenix', name: 'USENIX', patterns: [/usenix/i],
    about: 'USENIX Security Symposium. Annual, top-tier security research alongside IEEE S&P. Covers vulnerability analysis, network security, and applied cryptography.' },
  { key: 'ndss',   name: 'NDSS',   patterns: [/ndss/i],
    about: 'Network and Distributed System Security Symposium. Annual, ISOC-sponsored. Network security, protocols, DNS security, and web security.' },
  { key: 'ccs',    name: 'CCS',    patterns: [/\bccs\b/i],
    about: 'ACM Conference on Computer and Communications Security. Annual since 1993, top-tier security research. Access control, cryptographic protocols, and systems security.' },
  // Other
  { key: 'icassp', name: 'ICASSP', patterns: [/icassp/i],
    about: 'IEEE International Conference on Acoustics, Speech and Signal Processing. Annual since 1976, the largest signal processing conference. Speech recognition, audio processing, and sensor arrays.' },
  { key: 'intersem', name: 'InterpretML', patterns: [/interpret\s?ml/i],
    about: 'Interpretable ML workshop — model interpretability and explainability research.' },
];

// Journal names (non-conference venues)
const JOURNALS: Array<{ key: string; name: string; patterns: RegExp[]; about: string }> = [
  { key: 'tmlr',    name: 'TMLR',    patterns: [/tmlr/i],
    about: 'Transactions on Machine Learning Research. Open-access ML journal since 2021, with rigorous review and no page limits. Published by ML Research Press.' },
  { key: 'jmlr',    name: 'JMLR',    patterns: [/jmlr/i],
    about: 'Journal of Machine Learning Research. Open-access since 2000, one of the most prestigious ML journals. Conference-level rigor with journal-length exposition.' },
  { key: 'pami',    name: 'TPAMI',   patterns: [/pami|ieee\s?trans.*pami/i],
    about: 'IEEE Transactions on Pattern Analysis and Machine Intelligence. Monthly since 1979, the top computer vision and pattern analysis journal. High-impact, long-form vision research.' },
  { key: 'ijcv',    name: 'IJCV',    patterns: [/\bijcv\b/i],
    about: 'International Journal of Computer Vision. Since 1987, the premier computer vision journal. Published by Springer, covering theoretical and applied vision research.' },
  { key: 'tACL',    name: 'TACL',    patterns: [/tacl/i],
    about: 'Transactions of the Association for Computational Linguistics. Open-access NLP journal with conference-level peer review. Papers presented at ACL or EMNLP.' },
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