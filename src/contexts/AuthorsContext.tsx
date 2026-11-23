import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { favouriteAuthorsStore, onStorageModeChange } from '../utils/storage';
import type { AuthorRef } from '../utils/researchApi';

interface AuthorsContextValue {
  favouriteAuthors: AuthorRef[];
  isFavourite: (key: string) => boolean;
  followAuthor: (name: string) => Promise<AuthorRef>;
  unfollowAuthor: (key: string) => Promise<void>;
  reload: () => Promise<void>;
}

const AuthorsContext = createContext<AuthorsContextValue | null>(null);

export function AuthorsProvider({ children }: { children: React.ReactNode }) {
  const [favouriteAuthors, setFavouriteAuthors] = useState<AuthorRef[]>([]);

  const reload = useCallback(async () => {
    try {
      setFavouriteAuthors(await favouriteAuthorsStore.getAll());
    } catch (e) {
      console.warn('[authors] failed to load favourite authors', e);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => onStorageModeChange(() => reload()), [reload]);

  const isFavourite = useCallback(
    (key: string) => favouriteAuthors.some(a => a.key === key),
    [favouriteAuthors],
  );

  const followAuthor = useCallback(async (name: string) => {
    const author = await favouriteAuthorsStore.add(name);
    setFavouriteAuthors(prev => {
      if (prev.some(a => a.key === author.key)) return prev;
      return [...prev, author].sort((a, b) => a.name.localeCompare(b.name));
    });
    return author;
  }, []);

  const unfollowAuthor = useCallback(async (key: string) => {
    await favouriteAuthorsStore.remove(key);
    setFavouriteAuthors(prev => prev.filter(a => a.key !== key));
  }, []);

  return (
    <AuthorsContext.Provider value={{ favouriteAuthors, isFavourite, followAuthor, unfollowAuthor, reload }}>
      {children}
    </AuthorsContext.Provider>
  );
}

export function useAuthors() {
  const ctx = useContext(AuthorsContext);
  if (!ctx) throw new Error('useAuthors must be inside AuthorsProvider');
  return ctx;
}
