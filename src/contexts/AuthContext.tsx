import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { Provider, ImapConfig } from '../types';
import { apiLogin, apiRegister, apiLogout, apiMe, apiChangePassword } from '../utils/researchApi';

const SESSION_KEY = 'arxiv_auth_session';
const LEGACY_IMAP_KEY = 'arxiv_imap_config';

export interface AuthUser {
  provider: Provider;
  accessToken?: string;
  tokenExpiry?: number;
  imapConfig?: ImapConfig;
  email?: string;
  name?: string;
  picture?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loginWithPassword: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  logout: () => void;
  isLoggingIn: boolean;
  loginError: string | null;
  clearError: () => void;
  isRestoring: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function saveSession(user: AuthUser) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(user)); } catch { /* ignore */ }
}
function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

function loadSession(): AuthUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const user = JSON.parse(raw) as AuthUser;
    // Sessions from the old Google/IMAP login can't authenticate against the
    // API any more. Preserve the IMAP credentials so Settings can pick them up.
    if (user.provider !== 'server') {
      if (user.imapConfig) {
        try { localStorage.setItem(LEGACY_IMAP_KEY, JSON.stringify(user.imapConfig)); } catch { /* ignore */ }
      }
      clearSession();
      return null;
    }
    if (!user.accessToken) { clearSession(); return null; }
    return user;
  } catch { return null; }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Restore a saved session only if the server still accepts it.
  useEffect(() => {
    const saved = loadSession();
    if (!saved) { setIsRestoring(false); return; }
    apiMe()
      .then(() => setUser(saved))
      .catch(() => { clearSession(); setUser(null); })
      .finally(() => setIsRestoring(false));
  }, []);

  const loginWithPassword = useCallback(async (email: string, password: string) => {
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const { token, user: account } = await apiLogin(email.trim(), password);
      const next: AuthUser = { provider: 'server', accessToken: token, email: account.email };
      saveSession(next);
      setUser(next);
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : 'Sign-in failed.');
      throw e;
    } finally {
      setIsLoggingIn(false);
    }
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const { token, user: account } = await apiRegister(email.trim(), password);
      const next: AuthUser = { provider: 'server', accessToken: token, email: account.email };
      saveSession(next);
      setUser(next);
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : 'Could not create the account.');
      throw e;
    } finally {
      setIsLoggingIn(false);
    }
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const { token } = await apiChangePassword(currentPassword, newPassword);
    setUser(prev => {
      if (!prev) return prev;
      const next = { ...prev, accessToken: token };
      saveSession(next);
      return next;
    });
  }, []);

  const logout = useCallback(() => {
    apiLogout().catch(() => { /* best-effort */ });
    clearSession();
    setUser(null);
  }, []);

  const clearError = useCallback(() => setLoginError(null), []);

  return (
    <AuthContext.Provider value={{
      user, loginWithPassword, register, changePassword, logout,
      isLoggingIn, loginError, clearError, isRestoring,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
