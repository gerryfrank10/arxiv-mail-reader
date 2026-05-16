import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Book } from '../types';
import {
  deleteBook as apiDeleteBook,
  getDbStatus,
  listBooks,
  newBookId,
  upsertBook as apiUpsertBook,
} from '../utils/researchApi';

interface BooksValue {
  books: Book[];
  loading: boolean;
  error: string | null;
  dbEnabled: boolean;
  refresh: () => Promise<void>;
  createBook: (partial: Partial<Book> & { title: string }) => Promise<Book>;
  updateBook: (id: string, patch: Partial<Book>) => Promise<void>;
  removeBook: (id: string) => Promise<void>;
}

const BooksContext = createContext<BooksValue | null>(null);

export function BooksProvider({ children }: { children: React.ReactNode }) {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dbEnabled, setDbEnabled] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await getDbStatus();
      setDbEnabled(status.enabled);
      if (status.enabled) {
        const data = await listBooks();
        setBooks(data);
      } else {
        setBooks([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load books');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const createBook = useCallback(async (partial: Partial<Book> & { title: string }) => {
    const now = Date.now();
    const book: Book = {
      id:        partial.id ?? newBookId(),
      title:     partial.title,
      authors:   partial.authors ?? [],
      isbn:      partial.isbn ?? null,
      year:      partial.year ?? null,
      publisher: partial.publisher ?? null,
      coverUrl:  partial.coverUrl ?? null,
      abstract:  partial.abstract ?? '',
      notes:     partial.notes ?? '',
      sourceUrl: partial.sourceUrl ?? null,
      tags:      partial.tags ?? [],
      createdAt: partial.createdAt ?? now,
      updatedAt: now,
    };
    await apiUpsertBook(book);
    setBooks(prev => [book, ...prev.filter(b => b.id !== book.id)]);
    return book;
  }, []);

  const updateBook = useCallback(async (id: string, patch: Partial<Book>) => {
    const existing = books.find(b => b.id === id);
    if (!existing) return;
    const updated: Book = { ...existing, ...patch, id, updatedAt: Date.now() };
    await apiUpsertBook(updated);
    setBooks(prev => prev.map(b => b.id === id ? updated : b));
  }, [books]);

  const removeBook = useCallback(async (id: string) => {
    await apiDeleteBook(id);
    setBooks(prev => prev.filter(b => b.id !== id));
  }, []);

  return (
    <BooksContext.Provider value={{ books, loading, error, dbEnabled, refresh, createBook, updateBook, removeBook }}>
      {children}
    </BooksContext.Provider>
  );
}

export function useBooks() {
  const ctx = useContext(BooksContext);
  if (!ctx) throw new Error('useBooks must be used inside BooksProvider');
  return ctx;
}
