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

export interface Settings {
  senderEmail: string;
  maxEmails: number;
  claudeApiKey?: string;
  s2ApiKey?: string;
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

export type Provider = 'google' | 'imap';

export interface ImapConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

export type SortField = 'date' | 'title' | 'authors' | 'score';
export type SortDir   = 'asc' | 'desc';
