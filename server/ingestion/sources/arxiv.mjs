// ArXiv source plugin: plans a historical sweep as category/month windows,
// fetches one checkpointable page, and converts Atom metadata into Papers.

export const ARXIV_CATEGORY_RE = /^[a-z][a-z-]*(\.[A-Za-z-]+)?$/i;

function decodeXmlText(value) {
  return String(value ?? '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseArxivEntry(entry, fallbackId) {
  const titleM = entry.match(/<title>([\s\S]*?)<\/title>/);
  const summaryM = entry.match(/<summary>([\s\S]*?)<\/summary>/);
  const publishedM = entry.match(/<published>([\s\S]*?)<\/published>/);
  const updatedM = entry.match(/<updated>([\s\S]*?)<\/updated>/);
  const commentM = entry.match(/<arxiv:comment[^>]*>([\s\S]*?)<\/arxiv:comment>/);
  const idM = entry.match(/<id>https?:\/\/arxiv\.org\/abs\/([^<\s]+)<\/id>/);
  const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)]
    .map(m => decodeXmlText(m[1]));
  const categories = [...entry.matchAll(/<category[^>]*term="([^"]+)"/g)].map(m => m[1]);
  const published = publishedM?.[1]?.trim() ?? '';
  const arxivId = (idM?.[1] ?? fallbackId ?? '').replace(/v\d+$/i, '');
  const rawDate = published || updatedM?.[1]?.trim() || '';
  return {
    arxivId,
    title: titleM ? decodeXmlText(titleM[1]) : '(untitled)',
    abstract: summaryM ? decodeXmlText(summaryM[1]) : '',
    authors,
    authorList: authors,
    categories,
    published,
    date: rawDate ? new Date(rawDate).toUTCString().replace(/^\w+, /, '').replace(/ GMT$/, '') : '',
    comments: commentM ? decodeXmlText(commentM[1]) : '',
  };
}

export function parseArxivEntries(xml) {
  const out = [];
  for (const match of String(xml ?? '').matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const meta = parseArxivEntry(match[1], null);
    // arXiv can return a placeholder Error entry for an invalid ID.
    if (meta.arxivId && meta.title !== 'Error') out.push(meta);
  }
  return out;
}

export function extractArxivMetadata(xml, requestedId) {
  const match = String(xml ?? '').match(/<entry>([\s\S]*?)<\/entry>/);
  return match ? parseArxivEntry(match[1], requestedId) : null;
}

export function extractArxivAbstract(xml) {
  const match = String(xml ?? '').match(/<entry[\s\S]*?<summary>([\s\S]*?)<\/summary>/);
  return match ? decodeXmlText(match[1]) : null;
}

function ymd(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dateBound(isoDate, endOfDay) {
  return `${isoDate.replaceAll('-', '')}${endOfDay ? '2359' : '0000'}`;
}

export function validateArxivHistoryConfig(input) {
  const categories = [...new Set(
    (Array.isArray(input?.categories) ? input.categories : String(input?.categories ?? '').split(','))
      .map(c => String(c).trim()).filter(Boolean),
  )];
  const currentYear = new Date().getUTCFullYear();
  const fromYear = Number(input?.fromYear);
  const toYear = Number(input?.toYear);

  if (categories.length === 0) throw new Error('Enter at least one arXiv category, such as cs.AI or cs.LG.');
  if (categories.length > 20) throw new Error('Choose no more than 20 categories per job.');
  const invalid = categories.filter(category => !ARXIV_CATEGORY_RE.test(category));
  if (invalid.length) throw new Error(`Invalid arXiv category: ${invalid.join(', ')}`);
  if (!Number.isInteger(fromYear) || fromYear < 2000 || fromYear > currentYear) {
    throw new Error(`Start year must be between 2000 and ${currentYear}.`);
  }
  if (!Number.isInteger(toYear) || toYear < fromYear || toYear > currentYear) {
    throw new Error(`End year must be between ${fromYear} and ${currentYear}.`);
  }
  return { categories, fromYear, toYear };
}

export function planArxivHistory(input) {
  const config = validateArxivHistoryConfig(input);
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  const slices = [];

  for (const category of config.categories) {
    for (let year = config.fromYear; year <= config.toYear; year++) {
      const lastMonth = year === currentYear ? currentMonth : 12;
      for (let month = 1; month <= lastMonth; month++) {
        const from = ymd(year, month, 1);
        const lastDay = daysInMonth(year, month);
        const to = ymd(year, month, year === currentYear && month === currentMonth
          ? Math.min(lastDay, now.getUTCDate())
          : lastDay);
        slices.push({
          category,
          year,
          month,
          from,
          to,
          label: `${category} · ${year}-${String(month).padStart(2, '0')}`,
        });
      }
    }
  }
  return { config, slices };
}

function searchQueryForSlice(slice) {
  const dateRange = `[${dateBound(slice.from, false)} TO ${dateBound(slice.to, true)}]`;
  return `cat:${slice.category} AND submittedDate:${dateRange}`;
}

function metaToPaper(meta, jobId) {
  const publishedAt = meta.published && !Number.isNaN(Date.parse(meta.published))
    ? new Date(meta.published)
    : new Date(`${meta.date} UTC`);
  return {
    id: `imp-${meta.arxivId}`,
    arxivId: meta.arxivId,
    date: meta.date,
    size: '',
    title: meta.title,
    authors: meta.authors.join(', '),
    authorList: meta.authors,
    categories: meta.categories,
    comments: meta.comments,
    abstract: meta.abstract,
    url: `https://arxiv.org/abs/${meta.arxivId}`,
    pdfUrl: `https://arxiv.org/pdf/${meta.arxivId}`,
    emailId: `history:${jobId}`,
    digestSubject: 'Historical arXiv import',
    digestDate: Number.isNaN(publishedAt.getTime()) ? new Date() : publishedAt,
    source: 'import',
    publisher: 'arXiv',
  };
}

export const arxivSource = {
  id: 'arxiv',
  label: 'arXiv',
  plan: planArxivHistory,
  async fetchPage({ slice, start, pageSize, jobId, request }) {
    const query = searchQueryForSlice(slice);
    const xml = await request(query, start, pageSize);
    const papers = parseArxivEntries(xml).map(meta => metaToPaper(meta, jobId));
    return { papers, hasMore: papers.length === pageSize };
  },
};
