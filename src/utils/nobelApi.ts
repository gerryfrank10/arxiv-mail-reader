// Typed client for the /api/nobel/* server endpoints (official Nobel Prize
// data, proxied and cached server-side).

import { authHeaders } from './researchApi';

export interface NobelLaureate {
  id: string;
  name: string;
  /** Share of the prize, e.g. "1" (unshared) or "1/3". */
  portion: string;
  motivation: string;
  /** Official nobelprize.org facts page for this laureate's prize. */
  nobelUrl: string | null;
  /** English Wikipedia article, when the API provides one. */
  wikipedia: string | null;
  birthYear: string | null;
  deathYear: string | null;
  country: string | null;
}

export interface NobelAward {
  category: string;
  laureates: NobelLaureate[];
}

export interface NobelYear {
  year: number;
  awards: NobelAward[];
}

export interface NobelData {
  fetchedAt: string;
  total: number;
  years: NobelYear[];
}

export async function apiGetNobelLaureates(): Promise<NobelData> {
  const r = await fetch('/api/nobel/laureates', { headers: authHeaders() });
  if (!r.ok) {
    const err = await r.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `Nobel Prize request failed (HTTP ${r.status})`);
  }
  return r.json() as Promise<NobelData>;
}
