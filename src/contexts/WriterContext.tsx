import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ResearchDocument } from '../types';
import {
  deleteDocument as apiDeleteDocument,
  getDbStatus,
  listDocuments,
  newDocumentId,
  upsertDocument as apiUpsertDocument,
} from '../utils/researchApi';

interface WriterValue {
  documents: ResearchDocument[];
  active:    ResearchDocument | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  dbEnabled: boolean;
  refresh: () => Promise<void>;
  setActiveId: (id: string | null) => void;
  newDocument: () => Promise<ResearchDocument>;
  updateActive: (patch: Partial<ResearchDocument>) => void;
  removeDocument: (id: string) => Promise<void>;
}

const WriterContext = createContext<WriterValue | null>(null);

const AUTOSAVE_DELAY_MS = 1000;

export function WriterProvider({ children }: { children: React.ReactNode }) {
  const [documents, setDocuments] = useState<ResearchDocument[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dbEnabled, setDbEnabled] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<ResearchDocument | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await getDbStatus();
      setDbEnabled(status.enabled);
      if (status.enabled) {
        const data = await listDocuments();
        setDocuments(data);
      } else {
        setDocuments([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const active = activeId ? (documents.find(d => d.id === activeId) ?? null) : null;

  const flushSave = useCallback(async () => {
    const doc = pendingSave.current;
    if (!doc) return;
    pendingSave.current = null;
    setSaving(true);
    try {
      await apiUpsertDocument(doc);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, []);

  const queueSave = useCallback((doc: ResearchDocument) => {
    pendingSave.current = doc;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { flushSave(); }, AUTOSAVE_DELAY_MS);
  }, [flushSave]);

  // Flush on unmount / page hide
  useEffect(() => {
    const onHide = () => { if (saveTimer.current) { clearTimeout(saveTimer.current); flushSave(); } };
    window.addEventListener('beforeunload', onHide);
    return () => {
      window.removeEventListener('beforeunload', onHide);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      flushSave();
    };
  }, [flushSave]);

  const setActiveId = useCallback((id: string | null) => {
    // Flush any pending edits to the previously-active doc before switching
    if (saveTimer.current) { clearTimeout(saveTimer.current); flushSave(); }
    setActiveIdState(id);
  }, [flushSave]);

  const newDocument = useCallback(async () => {
    const now = Date.now();
    const doc: ResearchDocument = {
      id:         newDocumentId(),
      title:      'Untitled',
      content:    '',
      paperRefs:  [],
      bookRefs:   [],
      tags:       [],
      status:     'draft',
      createdAt:  now,
      updatedAt:  now,
    };
    await apiUpsertDocument(doc);
    setDocuments(prev => [doc, ...prev]);
    setActiveIdState(doc.id);
    return doc;
  }, []);

  const updateActive = useCallback((patch: Partial<ResearchDocument>) => {
    if (!activeId) return;
    setDocuments(prev => {
      const idx = prev.findIndex(d => d.id === activeId);
      if (idx < 0) return prev;
      const merged: ResearchDocument = {
        ...prev[idx],
        ...patch,
        id: activeId,
        updatedAt: Date.now(),
      };
      // Recalculate wordCount locally so the UI reflects edits immediately
      if (patch.content !== undefined) {
        merged.wordCount = merged.content.trim() === '' ? 0 : merged.content.trim().split(/\s+/).length;
      }
      const next = [...prev];
      next[idx] = merged;
      queueSave(merged);
      return next;
    });
  }, [activeId, queueSave]);

  const removeDocument = useCallback(async (id: string) => {
    await apiDeleteDocument(id);
    setDocuments(prev => prev.filter(d => d.id !== id));
    if (activeId === id) setActiveIdState(null);
  }, [activeId]);

  return (
    <WriterContext.Provider value={{
      documents, active, loading, saving, error, dbEnabled,
      refresh, setActiveId, newDocument, updateActive, removeDocument,
    }}>
      {children}
    </WriterContext.Provider>
  );
}

export function useWriter() {
  const ctx = useContext(WriterContext);
  if (!ctx) throw new Error('useWriter must be used inside WriterProvider');
  return ctx;
}
