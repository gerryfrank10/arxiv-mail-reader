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

export interface EmailDigest {
  id: string;
  date: Date;
  subject: string;
  papers: Paper[];
}

export interface Settings {
  senderEmail: string;
  maxEmails: number;
}

export type Provider = 'google' | 'imap';

export interface ImapConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}
