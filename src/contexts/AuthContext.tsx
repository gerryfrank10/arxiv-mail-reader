import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useGoogleLogin, googleLogout } from '@react-oauth/google';
import { Provider, ImapConfig } from '../types';

const SESSION_KEY = 'arxiv_auth_session';
const GOOGLE_TOKEN_TTL = 55 * 60 * 1000;

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
  loginWithGoogle: () => void;
  loginWithImap: (config: ImapConfig, email: string) => void;
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
    if (user.provider === 'google' && (!user.tokenExpiry || Date.now() > user.tokenExpiry)) {
      clearSession();
      return null;
    }
    return user;
  } catch { return null; }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    const saved = loadSession();
    if (saved) setUser(saved);
    setIsRestoring(false);
  }, []);

  const googleLogin = useGoogleLogin({
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
    onSuccess: async (tokenResponse) => {
      const token = tokenResponse.access_token;
      let profile: { email?: string; name?: string; picture?: string } = {};
      try {
        const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${token}` },
        });
        profile = await r.json();
      } catch { /* use empty profile */ }
      const next: AuthUser = {
        provider: 'google',
        accessToken: token,
        tokenExpiry: Date.now() + GOOGLE_TOKEN_TTL,
        email: profile.email,
        name: profile.name,
        picture: profile.picture,
      };
      setUser(next);
      saveSession(next);
      setIsLoggingIn(false);
      setLoginError(null);
    },
    onError: (err) => {
      setLoginError(err.error_description ?? 'Sign-in failed.');
      setIsLoggingIn(false);
    },
  });

  const loginWithGoogle = useCallback(() => {
    setIsLoggingIn(true);
    setLoginError(null);
    googleLogin();
  }, [googleLogin]);

  const loginWithImap = useCallback((config: ImapConfig, email: string) => {
    const next: AuthUser = { provider: 'imap', imapConfig: config, email };
    setUser(next);
    saveSession(next);
    setLoginError(null);
  }, []);

  const logout = useCallback(() => {
    if (user?.provider === 'google') googleLogout();
    clearSession();
    setUser(null);
  }, [user]);

  const clearError = useCallback(() => setLoginError(null), []);

  return (
    <AuthContext.Provider value={{ user, loginWithGoogle, loginWithImap, logout, isLoggingIn, loginError, clearError, isRestoring }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
