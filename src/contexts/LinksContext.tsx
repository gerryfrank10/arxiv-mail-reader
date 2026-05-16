import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { EntityKind, Link, LinkRel } from '../types';
import { addLink as apiAdd, deleteLink as apiDelete, getDbStatus, listLinks } from '../utils/researchApi';

interface LinksValue {
  links: Link[];
  loading: boolean;
  dbEnabled: boolean;
  refresh: () => Promise<void>;
  // Add a link both ways for bidirectional semantics (e.g. 'related').
  // For directional rels ('cites', 'extends'), only the source -> target row is added.
  addLink:    (l: { sourceKind: EntityKind; sourceId: string; targetKind: EntityKind; targetId: string; rel?: LinkRel; note?: string; }) => Promise<void>;
  removeLink: (l: { sourceKind: EntityKind; sourceId: string; targetKind: EntityKind; targetId: string; rel: LinkRel; }) => Promise<void>;
  // "Everything linked to this entity, regardless of direction"
  linksFor:   (kind: EntityKind, id: string) => Link[];
}

const LinksContext = createContext<LinksValue | null>(null);

const BIDIRECTIONAL_RELS: Set<LinkRel> = new Set(['related']);

export function LinksProvider({ children }: { children: React.ReactNode }) {
  const [links, setLinks] = useState<Link[]>([]);
  const [loading, setLoading] = useState(false);
  const [dbEnabled, setDbEnabled] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await getDbStatus();
      setDbEnabled(s.enabled);
      if (s.enabled) setLinks(await listLinks());
      else           setLinks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const addLink = useCallback(async (l: { sourceKind: EntityKind; sourceId: string; targetKind: EntityKind; targetId: string; rel?: LinkRel; note?: string; }) => {
    const rel = l.rel ?? 'related';
    await apiAdd({ ...l, rel, note: l.note ?? '' });
    if (BIDIRECTIONAL_RELS.has(rel)) {
      await apiAdd({
        sourceKind: l.targetKind, sourceId: l.targetId,
        targetKind: l.sourceKind, targetId: l.sourceId,
        rel, note: l.note ?? '',
      });
    }
    refresh();
  }, [refresh]);

  const removeLink = useCallback(async (l: { sourceKind: EntityKind; sourceId: string; targetKind: EntityKind; targetId: string; rel: LinkRel; }) => {
    await apiDelete(l);
    if (BIDIRECTIONAL_RELS.has(l.rel)) {
      await apiDelete({
        sourceKind: l.targetKind, sourceId: l.targetId,
        targetKind: l.sourceKind, targetId: l.sourceId,
        rel: l.rel,
      });
    }
    refresh();
  }, [refresh]);

  // index by (kind, id) for O(1) lookups
  const indexed = useMemo(() => {
    const m = new Map<string, Link[]>();
    for (const l of links) {
      const k1 = `${l.sourceKind}:${l.sourceId}`;
      const k2 = `${l.targetKind}:${l.targetId}`;
      m.set(k1, [...(m.get(k1) ?? []), l]);
      // Avoid duplicate listing for bidirectional 'related' pairs since they
      // exist as two separate rows already. The non-related directional rels
      // only appear on source — surface the reverse view here for visibility.
      if (!BIDIRECTIONAL_RELS.has(l.rel)) {
        m.set(k2, [...(m.get(k2) ?? []), l]);
      }
    }
    return m;
  }, [links]);

  const linksFor = useCallback((kind: EntityKind, id: string) => indexed.get(`${kind}:${id}`) ?? [], [indexed]);

  return (
    <LinksContext.Provider value={{ links, loading, dbEnabled, refresh, addLink, removeLink, linksFor }}>
      {children}
    </LinksContext.Provider>
  );
}

export function useLinks() {
  const ctx = useContext(LinksContext);
  if (!ctx) throw new Error('useLinks must be used inside LinksProvider');
  return ctx;
}
