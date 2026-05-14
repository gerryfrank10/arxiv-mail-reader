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

export interface Settings {
  senderEmail: string;
  maxEmails: number;
  // Legacy single-key fields (kept for backward compat — used as fallback)
  claudeApiKey?: string;
  s2ApiKey?: string;
  // Multi-provider config
  ai?: AIConfig;
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

export interface Tracker {
  id: string;
  name: string;
  description: string;       // long paragraph for Claude scoring
  keywords: string[];
  seedArxivIds: string[];    // anchor papers for similarity scoring
  enabled: boolean;
  color: string;             // tailwind color name e.g. 'blue', 'rose'
  minScore: number;          // 0..100 threshold for surfacing matches
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

export type Provider = 'google' | 'imap';

export interface ImapConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

export type SortField = 'date' | 'title' | 'authors' | 'score';
export type SortDir   = 'asc' | 'desc';
