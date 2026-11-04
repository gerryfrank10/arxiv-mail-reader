// Publishing venue/platform detection for the dashboard feed.
//
// Today almost everything is arXiv, but the app is growing parsers for other
// sites (see docs/PARSERS.md). Keep the "where was this published?" answer in
// one place so cards, filters and future importers agree:
//   1. an explicit `paper.publisher` (set by an importer/parser) wins,
//   2. otherwise infer from the URL/DOI/arXiv id,
//   3. otherwise fall back to the raw hostname, or "Local upload".
import { Paper } from '../types';

export interface PublisherInfo {
  key: string;
  name: string;
  short: string;
  // Tailwind classes for the avatar + badge.
  bg: string;
  text: string;
  border: string;
}

const KNOWN: Array<{ test: RegExp; info: PublisherInfo }> = [
  {
    test: /arxiv/i,
    info: {
      key: 'arxiv', name: 'arXiv', short: 'arX',
      bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200',
    },
  },
  {
    test: /openreview/i,
    info: {
      key: 'openreview', name: 'OpenReview', short: 'OR',
      bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200',
    },
  },
  {
    test: /aclanthology|association for computational linguistics/i,
    info: {
      key: 'acl', name: 'ACL Anthology', short: 'ACL',
      bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200',
    },
  },
  {
    test: /proceedings\.mlr\.press|pmlr/i,
    info: {
      key: 'pmlr', name: 'PMLR', short: 'PMLR',
      bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200',
    },
  },
  {
    test: /neurips|nips\.cc/i,
    info: {
      key: 'neurips', name: 'NeurIPS', short: 'N',
      bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200',
    },
  },
  {
    test: /biorxiv/i,
    info: {
      key: 'biorxiv', name: 'bioRxiv', short: 'bio',
      bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200',
    },
  },
  {
    test: /medrxiv/i,
    info: {
      key: 'medrxiv', name: 'medRxiv', short: 'med',
      bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200',
    },
  },
  {
    test: /ieee|ieeexplore/i,
    info: {
      key: 'ieee', name: 'IEEE Xplore', short: 'IEEE',
      bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200',
    },
  },
  {
    test: /dl\.acm\.org|acm digital library/i,
    info: {
      key: 'acm', name: 'ACM DL', short: 'ACM',
      bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300',
    },
  },
  {
    test: /nature\.com/i,
    info: {
      key: 'nature', name: 'Nature', short: 'N',
      bg: 'bg-green-50', text: 'text-green-800', border: 'border-green-200',
    },
  },
  {
    test: /science\.org/i,
    info: {
      key: 'science', name: 'Science', short: 'S',
      bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-200',
    },
  },
  {
    test: /springer|link\.springer/i,
    info: {
      key: 'springer', name: 'Springer', short: 'Sp',
      bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200',
    },
  },
  {
    test: /sciencedirect|elsevier/i,
    info: {
      key: 'elsevier', name: 'Elsevier', short: 'El',
      bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200',
    },
  },
  {
    test: /pubmed|ncbi\.nlm\.nih\.gov/i,
    info: {
      key: 'pubmed', name: 'PubMed', short: 'PM',
      bg: 'bg-lime-50', text: 'text-lime-700', border: 'border-lime-200',
    },
  },
  {
    test: /semanticscholar/i,
    info: {
      key: 's2', name: 'Semantic Scholar', short: 'S2',
      bg: 'bg-cyan-50', text: 'text-cyan-800', border: 'border-cyan-200',
    },
  },
];

function fallbackForKey(key: string): PublisherInfo {
  const cleaned = key.replace(/^www\./i, '');
  const name = cleaned
    .split('.')[0]
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase()) || 'Unknown';
  const short = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
  return {
    key: cleaned || 'unknown', name, short,
    bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200',
  };
}

function hostOf(raw: string | undefined): string {
  if (!raw) return '';
  try {
    return new URL(raw).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

export function publisherOf(paper: Paper): PublisherInfo {
  // 1) Explicit value from an importer/parser.
  const explicit = (paper.publisher ?? '').trim();
  if (explicit) {
    const hit = KNOWN.find(k => k.test.test(explicit));
    if (hit) return hit.info;
    return { ...fallbackForKey(explicit), name: explicit };
  }

  // 2) arXiv ids/URLs (the current default).
  if (paper.arxivId || /arxiv\.org/i.test(paper.url ?? '')) {
    const hit = KNOWN.find(k => k.info.key === 'arxiv');
    if (hit) return hit.info;
  }

  // 3) URL / PDF host.
  const host = hostOf(paper.url) || hostOf(paper.pdfUrl);
  if (host) {
    const hit = KNOWN.find(k => k.test.test(host));
    if (hit) return hit.info;
    return fallbackForKey(host);
  }

  // 4) Uploaded files have no remote publisher.
  if (paper.source === 'upload') {
    return {
      key: 'local', name: 'Local upload', short: 'PDF',
      bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200',
    };
  }

  return {
    key: 'unknown', name: 'Unknown source', short: '?',
    bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200',
  };
}
