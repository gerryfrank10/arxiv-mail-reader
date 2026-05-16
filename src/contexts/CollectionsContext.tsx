import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Collection, CollectionItemStatus, EntityKind } from '../types';
import {
  addCollectionItem as apiAddItem,
  deleteCollection as apiDeleteColl,
  getDbStatus,
  listCollections,
  newCollectionId,
  removeCollectionItem as apiRemoveItem,
  updateCollectionItem as apiUpdateItem,
  upsertCollection as apiUpsertColl,
} from '../utils/researchApi';

interface CollectionsValue {
  collections: Collection[];
  loading: boolean;
  error: string | null;
  dbEnabled: boolean;
  refresh: () => Promise<void>;
  createCollection: (partial: Partial<Collection> & { name: string }) => Promise<Collection>;
  updateCollection: (id: string, patch: Partial<Collection>) => Promise<void>;
  removeCollection: (id: string) => Promise<void>;
  addItem:    (collectionId: string, item: { targetKind: EntityKind; targetId: string }) => Promise<void>;
  removeItem: (collectionId: string, targetKind: EntityKind, targetId: string) => Promise<void>;
  setItemStatus: (collectionId: string, targetKind: EntityKind, targetId: string, status: CollectionItemStatus) => Promise<void>;
  // For per-entity lookups (e.g. "which collections include this paper?")
  collectionsContaining: (kind: EntityKind, id: string) => Collection[];
}

const CollectionsContext = createContext<CollectionsValue | null>(null);

export function CollectionsProvider({ children }: { children: React.ReactNode }) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dbEnabled, setDbEnabled] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await getDbStatus();
      setDbEnabled(s.enabled);
      if (s.enabled) setCollections(await listCollections());
      else           setCollections([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load collections');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const createCollection = useCallback(async (partial: Partial<Collection> & { name: string }) => {
    const now = Date.now();
    const coll: Collection = {
      id:          partial.id ?? newCollectionId(),
      name:        partial.name,
      description: partial.description ?? '',
      color:       partial.color ?? 'blue',
      tags:        partial.tags ?? [],
      kind:        partial.kind ?? 'collection',
      items:       [],
      createdAt:   partial.createdAt ?? now,
      updatedAt:   now,
    };
    await apiUpsertColl(coll);
    setCollections(prev => [coll, ...prev.filter(c => c.id !== coll.id)]);
    return coll;
  }, []);

  const updateCollection = useCallback(async (id: string, patch: Partial<Collection>) => {
    const existing = collections.find(c => c.id === id);
    if (!existing) return;
    const updated: Collection = { ...existing, ...patch, id, updatedAt: Date.now() };
    await apiUpsertColl(updated);
    setCollections(prev => prev.map(c => c.id === id ? updated : c));
  }, [collections]);

  const removeCollection = useCallback(async (id: string) => {
    await apiDeleteColl(id);
    setCollections(prev => prev.filter(c => c.id !== id));
  }, []);

  const addItem = useCallback(async (collectionId: string, item: { targetKind: EntityKind; targetId: string }) => {
    await apiAddItem({ collectionId, targetKind: item.targetKind, targetId: item.targetId, status: 'unread', notes: '' });
    refresh();
  }, [refresh]);

  const removeItem = useCallback(async (collectionId: string, targetKind: EntityKind, targetId: string) => {
    await apiRemoveItem(collectionId, targetKind, targetId);
    setCollections(prev => prev.map(c => c.id === collectionId
      ? { ...c, items: c.items.filter(i => !(i.targetKind === targetKind && i.targetId === targetId)) }
      : c));
  }, []);

  const setItemStatus = useCallback(async (collectionId: string, targetKind: EntityKind, targetId: string, status: CollectionItemStatus) => {
    await apiUpdateItem({ collectionId, targetKind, targetId, status });
    setCollections(prev => prev.map(c => c.id === collectionId
      ? { ...c, items: c.items.map(i => i.targetKind === targetKind && i.targetId === targetId ? { ...i, status } : i) }
      : c));
  }, []);

  const collectionsContaining = useCallback((kind: EntityKind, id: string) =>
    collections.filter(c => c.items.some(i => i.targetKind === kind && i.targetId === id)),
    [collections]
  );

  return (
    <CollectionsContext.Provider value={{
      collections, loading, error, dbEnabled, refresh,
      createCollection, updateCollection, removeCollection,
      addItem, removeItem, setItemStatus, collectionsContaining,
    }}>
      {children}
    </CollectionsContext.Provider>
  );
}

export function useCollections() {
  const ctx = useContext(CollectionsContext);
  if (!ctx) throw new Error('useCollections must be used inside CollectionsProvider');
  return ctx;
}
