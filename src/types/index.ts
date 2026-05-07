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
}
