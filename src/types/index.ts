export interface Paper {
  id: string;
  arxivId: string;
  date: string;
  size: string;
  title: string;
  authors: string;
  authorList: string[];
  categories: string[];
  comments: string;
  abstract: string;
  url: string;
  pdfUrl: string;
  emailId: string;
  digestSubject: string;
  digestDate: Date;
}

// AI providers supported. Anthropic uses its own protocol; everything else
// speaks OpenAI-compatible chat-completions over the same shape.
export type AIProvider = 'claude' | 'openai' | 'groq' | 'ollama' | 'custom' | 'none';

export interface AIConfig {
  provider: AIProvider;
  apiKey?: string;       // ignored for ollama
  baseUrl?: string;      // for ollama/custom; defaulted per-provider otherwise
  model?: string;        // optional override
}

/** Named tier of an AI profile. 'default' is used for routine high-volume
 *  tasks (tracker scoring, correlations); 'premium' is for the few tasks
 *  where quality matters more than cost (editorials, summaries). */
export type AIProfileSlot = 'default' | 'premium';

/** Purposes correspond to the `purpose:` tag passed to aiChat(). */
export type AIPurpose =
  | 'tracker-score'
  | 'magazine-editorial'
  | 'paper-summary'
  | 'ai-suggest'
  | 'writer-cite-suggest'
  | 'connection-test'
  | 'chat';

export type AIRoutingMap = Partial<Record<AIPurpose, AIProfileSlot>>;

export interface AIProfiles {
  default?: AIConfig;
  premium?: AIConfig;
}

export interface Settings {
  senderEmail: string;
  maxEmails: number;
  // Legacy single-key fields (kept for backward compat — used as fallback)
  claudeApiKey?: string;
  s2ApiKey?: string;
  // Legacy single-provider AIConfig (kept as fallback when aiProfiles unset)
  ai?: AIConfig;
  // Two-tier AI profiles. When set, supersede `ai`.
  aiProfiles?: AIProfiles;
  // Per-purpose overrides. When unset, the built-in default mapping is used.
  aiRouting?: AIRoutingMap;
}

export interface S2Author {
  authorId?: string;
  name: string;
}

export interface S2Paper {
  paperId: string;
  externalIds?: { ArXiv?: string; DOI?: string; [k: string]: string | undefined };
  title: string;
  abstract?: string | null;
  authors: S2Author[];
  year?: number | null;
  venue?: string | null;
  citationCount?: number;
  influentialCitationCount?: number;
  publicationTypes?: string[] | null;
  openAccessPdf?: { url?: string } | null;
  url?: string;
  tldr?: { text?: string } | null;
}

export interface S2AuthorProfile {
  authorId: string;
  name: string;
  affiliations?: string[];
  hIndex?: number;
  citationCount?: number;
  paperCount?: number;
  url?: string;
}

// ---------- Tracking ----------

export type TrackerAutoScoreMode = 'manual' | 'keyword' | 'ai';

export interface Tracker {
  id: string;
  name: string;
  description: string;       // long paragraph for Claude scoring
  keywords: string[];
  seedArxivIds: string[];    // anchor papers for similarity scoring
  enabled: boolean;
  color: string;             // tailwind color name e.g. 'blue', 'rose'
  minScore: number;          // 0..100 threshold for surfacing matches
  /** How new papers from sync are scored. Defaults to 'manual' — no surprise
   *  AI calls. Manual scoring is always available via the 'Score with AI'
   *  button or the scripts/score-papers.mjs CLI. */
  autoScoreMode: TrackerAutoScoreMode;
  createdAt: number;
  updatedAt: number;
}

export interface PaperScore {
  id: string;                // `${paperId}:${trackerId}`
  paperId: string;
  trackerId: string;
  score: number;             // 0..100
  rationale: string;
  source: 'claude' | 'keyword';
  ts: number;
}

// ---------- Books ----------

export interface Book {
  id: string;
  title: string;
  authors: string[];
  isbn?: string | null;
  year?: number | null;
  publisher?: string | null;
  coverUrl?: string | null;
  abstract: string;
  notes: string;
  sourceUrl?: string | null;
  tags: string[];
  // Attached file (PDF/EPUB/etc) — server-side upload
  filePath?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  originalFilename?: string | null;
  uploadedAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

// ---------- Writer documents ----------

export type DocumentStatus = 'draft' | 'in_review' | 'published';

export interface ResearchDocument {
  id: string;
  title: string;
  content: string;             // markdown
  paperRefs: string[];         // arxiv ids
  bookRefs:  string[];         // book ids
  tags: string[];
  status: DocumentStatus;
  wordCount?: number;
  createdAt: number;
  updatedAt: number;
}

// ---------- Collections / Learning paths ----------

export type EntityKind = 'paper' | 'book' | 'document';
export type CollectionKind = 'collection' | 'learning_path';
export type CollectionItemStatus = 'unread' | 'in_progress' | 'done';

export interface CollectionItem {
  collectionId: string;
  targetKind:   EntityKind;
  targetId:     string;
  position:     number;
  status:       CollectionItemStatus;
  notes:        string;
  addedAt:      number;
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  color: string;
  tags: string[];
  kind: CollectionKind;
  items: CollectionItem[];
  createdAt: number;
  updatedAt: number;
}

// ---------- Links (cross-references) ----------

export type LinkRel = 'related' | 'cites' | 'extends' | 'contradicts' | 'background';

export interface Link {
  sourceKind: EntityKind;
  sourceId:   string;
  targetKind: EntityKind;
  targetId:   string;
  rel:        LinkRel;
  note:       string;
  createdAt:  number;
}

// ---------- Magazine ----------

export type MagazineSource = 'hackernews' | 'huggingface' | 'github' | 'modelscope';

// Source items — minimal shapes the renderer needs
export interface MagazineHNItem      { id: string; title: string; url: string; discussion: string; points: number; comments: number; by: string; ts: number; }
export interface MagazineHFItem      { id: string; name: string; author: string; downloads: number; likes: number; tags: string[]; pipeline: string | null; library: string | null; url: string; ts: number; }
export interface MagazineGitHubItem  { id: string; name: string; description: string; url: string; stars: number; forks: number; language: string; topics: string[]; ts: number; owner: string; ownerAvatar: string | null; }
export interface MagazineMSItem      { id: string; name: string; chineseName: string; author: string; downloads: number; stars: number; tags: string[]; url: string; ts: number; }

export interface MagazineExternal {
  hackernews?:  MagazineHNItem[];
  huggingface?: MagazineHFItem[];
  github?:      MagazineGitHubItem[];
  modelscope?:  MagazineMSItem[];
}

// A draft is what the server returns after collecting raw data — the
// client adds the AI editorial and POSTs back a finished issue.
export interface MagazineDraft {
  weekStart:     string;
  weekEnd:       string;
  editionNumber: number;
  sources:       MagazineSource[];
  sourceErrors:  Record<string, string>;
  /** Capped subset (server-side limit ~200) of the inbox papers for the
   *  week — kept small so the saved JSONB stays light. */
  inboxPapers:   Paper[];
  /** Total inbox papers for the week, before the server cap. Used by the
   *  reader to render "X this week" honestly. */
  inboxTotal:    number;
  external:      MagazineExternal;
}

export interface MagazineEditorial {
  cover:     string;     // 2-3 sentence cover blurb
  inboxNote: string;     // 1 paragraph about the user's inbox highlights
  takeaways: string[];   // 3-5 bullet "this week in research" takeaways
}

export interface MagazineContent {
  editorial?: MagazineEditorial;
  /** Top-N papers (by assessment score) we want to render + cite. Kept
   *  small — the magazine view only needs ~6 highlights and the editorial
   *  only sees the top 8. */
  inboxPapers: Paper[];
  /** Original count of inbox papers for the week, before truncation. */
  inboxTotalCount?: number;
  external:    MagazineExternal;
  /** Source errors carried into the issue so the reader sees what failed */
  sourceErrors?: Record<string, string>;
}

export interface MagazineIssue {
  id:            string;
  weekStart:     string;   // YYYY-MM-DD
  weekEnd:       string;
  editionNumber: number;
  title:         string;
  subtitle:      string;
  content:       MagazineContent;
  sources:       MagazineSource[];
  aiProvider:    string | null;
  createdAt:     number;
}

/** Summary used in the issue list — full content omitted to keep payloads small */
export interface MagazineIssueSummary {
  id:            string;
  weekStart:     string;
  weekEnd:       string;
  editionNumber: number;
  title:         string;
  subtitle:      string;
  sources:       MagazineSource[];
  aiProvider:    string | null;
  createdAt:     number;
  sectionKeys:   string[];
}

export type Provider = 'google' | 'imap';

export interface ImapConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

export type SortField = 'date' | 'title' | 'authors' | 'score';
export type SortDir   = 'asc' | 'desc';
