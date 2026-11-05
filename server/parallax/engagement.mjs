// Parallax public engagement store — likes, comments, challenges.
//
// Pilot semantics:
//   * Anonymous device-scoped identity: callers send an opaque
//     `x-parallax-device` header (random client-side ID). No account
//     emails or personal data are ever stored here.
//   * Stable pseudonym per device ("Reader ab12") so threads read like a
//     conversation without identifying anyone.
//   * Storage is a JSON file under server/parallax/data/ (created on
//     first write, atomic tmp+rename saves). Good enough for the pilot;
//     swap for a table when the product grows real users.

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), 'data');
const STORE_PATH = join(DATA_DIR, 'engagement.json');

const MAX_LIST = 200;          // comments/challenges kept per paper
const MAX_TEXT = 2000;          // chars per post
const MAX_AUTHOR = 24;

let store = null;
let saveTimer = null;

function defaultPaper() {
  return { likes: [], comments: [], challenges: [] };
}

function load() {
  if (store) return store;
  try {
    store = JSON.parse(readFileSync(STORE_PATH, 'utf8'));
    if (!store || typeof store !== 'object' || !store.papers) throw new Error('bad shape');
  } catch {
    store = { schemaVersion: 1, papers: {} };
  }
  return store;
}

function persistNow() {
  const snapshot = JSON.stringify(store, null, 2);
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${STORE_PATH}.tmp-${process.pid}`;
  writeFileSync(tmp, snapshot);
  renameSync(tmp, STORE_PATH);
}

function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 250);
}

function paperState(arxivId) {
  const s = load();
  const id = String(arxivId).slice(0, 64);
  if (!s.papers[id]) s.papers[id] = defaultPaper();
  return s.papers[id];
}

function sanitizeText(raw) {
  if (typeof raw !== 'string') return '';
  // Strip control chars except newlines/tabs, collapse, cap length.
  let text = raw.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ' ');
  text = text.replace(/[ \t]{2,}/g, ' ').trim();
  return text.slice(0, MAX_TEXT);
}

// Stable short pseudonym derived from the device id (non-reversible in practice
// for pilot purposes; not a security boundary).
function pseudonymFor(deviceId) {
  let h = 0;
  for (let i = 0; i < deviceId.length; i++) {
    h = (h * 31 + deviceId.charCodeAt(i)) >>> 0;
  }
  return `Reader ${h.toString(16).padStart(4, '0').slice(-4)}`;
}

function deviceIdFrom(req) {
  const raw = String(req.get?.('x-parallax-device') ?? req.headers?.['x-parallax-device'] ?? '');
  const clean = raw.replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
  return clean.length >= 8 ? clean : null;
}

function summarize(state, deviceId) {
  const strip = ({ deviceId: _drop, ...rest }) => ({ ...rest, mine: deviceId ? _drop === deviceId : false });
  return {
    schemaVersion: 1,
    likes: state.likes.length,
    liked: deviceId ? state.likes.includes(deviceId) : false,
    comments: state.comments.slice(-MAX_LIST).reverse().map(strip),
    challenges: state.challenges.slice(-MAX_LIST).reverse().map(strip),
  };
}

function addPost(list, deviceId, text) {
  const entry = {
    id: randomUUID(),
    author: pseudonymFor(deviceId),
    text,
    createdAt: new Date().toISOString(),
    deviceId, // kept server-side only; never returned to clients
  };
  list.push(entry);
  if (list.length > MAX_LIST) list.splice(0, list.length - MAX_LIST);
  persist();
  const { deviceId: _drop, ...publicEntry } = entry;
  return { ...publicEntry, mine: true };
}

export function getEngagement(arxivId, req) {
  const state = paperState(arxivId);
  return summarize(state, deviceIdFrom(req));
}

export function toggleLike(arxivId, req) {
  const deviceId = deviceIdFrom(req);
  if (!deviceId) return { error: 'Missing or malformed x-parallax-device header.', status: 400 };
  const state = paperState(arxivId);
  const at = state.likes.indexOf(deviceId);
  if (at >= 0) state.likes.splice(at, 1);
  else state.likes.push(deviceId);
  if (state.likes.length > 5000) state.likes.splice(0, state.likes.length - 5000);
  persist();
  return { ...summarize(state, deviceId) };
}

export function addComment(arxivId, req) {
  const deviceId = deviceIdFrom(req);
  if (!deviceId) return { error: 'Missing or malformed x-parallax-device header.', status: 400 };
  const text = sanitizeText(req.body?.text);
  if (!text) return { error: 'Comment text is required (max 2000 chars).', status: 400 };
  const state = paperState(arxivId);
  const entry = addPost(state.comments, deviceId, text);
  return { ...summarize(state, deviceId), created: entry };
}

export function addChallenge(arxivId, req) {
  const deviceId = deviceIdFrom(req);
  if (!deviceId) return { error: 'Missing or malformed x-parallax-device header.', status: 400 };
  const text = sanitizeText(req.body?.text);
  if (!text) return { error: 'Challenge text is required (max 2000 chars).', status: 400 };
  const state = paperState(arxivId);
  const entry = addPost(state.challenges, deviceId, text);
  return { ...summarize(state, deviceId), created: entry };
}

// Test seam.
export function _resetStoreForTests() {
  store = null;
  if (existsSync(STORE_PATH)) {
    try { readFileSync(STORE_PATH); } catch { /* unreadable -> fresh */ }
  }
  persistNow();
}