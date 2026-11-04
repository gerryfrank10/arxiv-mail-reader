import { useState, FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';

type Mode = 'login' | 'register';

export default function LoginPage() {
  const { loginWithPassword, register, isLoggingIn, loginError, clearError } = useAuth();

  const [mode, setMode]         = useState<Mode>('login');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const isRegister = mode === 'register';

  function switchMode(next: Mode) {
    setMode(next);
    setLocalError(null);
    setPassword('');
    setConfirm('');
    clearError();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);

    const trimmed = email.trim();
    if (!trimmed) { setLocalError('Enter your email address.'); return; }

    if (isRegister) {
      if (password.length < 8) { setLocalError('Password must be at least 8 characters.'); return; }
      if (password !== confirm) { setLocalError('Passwords do not match.'); return; }
      try {
        await register(trimmed, password);
      } catch { /* error surfaced through loginError */ }
      return;
    }

    if (!password) { setLocalError('Enter your password.'); return; }
    try {
      await loginWithPassword(trimmed, password);
    } catch { /* error surfaced through loginError */ }
  }

  const error = localError ?? loginError;
  const canSubmit = !!email.trim() && !!password && !isLoggingIn;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="w-full max-w-sm px-8 py-10 rounded-2xl bg-slate-800/60 border border-slate-700 backdrop-blur-sm shadow-2xl">

        {/* Logo + title */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/30 mb-4">
            <svg viewBox="0 0 24 24" fill="none" className="w-9 h-9 text-white" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">arXiv Mail Reader</h1>
          <p className="text-slate-400 text-xs mt-1 text-center leading-relaxed">
            {isRegister
              ? 'Create an account to build your own paper library.'
              : 'Sign in to read your papers.'}
          </p>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-red-900/40 border border-red-700 text-red-300 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Email</label>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setLocalError(null); clearError(); }}
              placeholder="you@example.com"
              className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Password</label>
            <input
              type="password"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              value={password}
              onChange={e => { setPassword(e.target.value); setLocalError(null); clearError(); }}
              placeholder="••••••••"
              className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          {isRegister && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">Confirm password</label>
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={e => { setConfirm(e.target.value); setLocalError(null); clearError(); }}
                placeholder="••••••••"
                className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-blue-600 text-white font-semibold text-sm hover:bg-blue-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-600/20"
          >
            {isLoggingIn && (
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {isLoggingIn
              ? (isRegister ? 'Creating account…' : 'Signing in…')
              : (isRegister ? 'Create account' : 'Sign in')}
          </button>
        </form>

        <div className="mt-5 text-center">
          {isRegister ? (
            <p className="text-xs text-slate-400">
              Already have an account?{' '}
              <button onClick={() => switchMode('login')} className="text-blue-400 hover:underline font-medium">
                Sign in
              </button>
            </p>
          ) : (
            <p className="text-xs text-slate-400">
              New here?{' '}
              <button onClick={() => switchMode('register')} className="text-blue-400 hover:underline font-medium">
                Create an account
              </button>
            </p>
          )}
        </div>

        <p className="mt-6 text-[10px] text-slate-500 leading-relaxed text-center">
          Email credentials for fetching arXiv digests are configured separately,
          after signing in, under Settings → Email &amp; sync.
        </p>
      </div>
    </div>
  );
}
