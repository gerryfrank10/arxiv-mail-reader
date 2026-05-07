import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ImapConfig } from '../types';

const IMAP_PRESETS: Record<string, { label: string; host: string; port: number }> = {
  icloud:  { label: 'iCloud Mail',       host: 'imap.mail.me.com',      port: 993 },
  outlook: { label: 'Outlook / Hotmail', host: 'imap-mail.outlook.com', port: 993 },
  yahoo:   { label: 'Yahoo Mail',        host: 'imap.mail.yahoo.com',   port: 993 },
  other:   { label: 'Other IMAP',        host: '',                      port: 993 },
};

interface Props {
  hasGoogle: boolean;
}

export default function LoginPage({ hasGoogle }: Props) {
  const { loginWithGoogle, loginWithImap, isLoggingIn, loginError, clearError } = useAuth();

  const [view, setView] = useState<'pick' | 'imap'>('pick');
  const [preset, setPreset] = useState<keyof typeof IMAP_PRESETS>('icloud');
  const [host, setHost]         = useState(IMAP_PRESETS.icloud.host);
  const [port, setPort]         = useState(String(IMAP_PRESETS.icloud.port));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [backendOk, setBackendOk] = useState<boolean | null>(null);

  useEffect(() => {
    if (view !== 'imap') return;
    let cancelled = false;
    setBackendOk(null);
    fetch('/api/health', { signal: AbortSignal.timeout(3000) })
      .then(r => { if (!cancelled) setBackendOk(r.ok); })
      .catch(() => { if (!cancelled) setBackendOk(false); });
    return () => { cancelled = true; };
  }, [view]);

  function selectPreset(key: keyof typeof IMAP_PRESETS) {
    setPreset(key);
    setHost(IMAP_PRESETS[key].host);
    setPort(String(IMAP_PRESETS[key].port));
    clearError();
  }

  function handleConnect() {
    const cfg: ImapConfig = { host, port: Number(port), username, password };
    loginWithImap(cfg, username);
  }

  const canConnect = backendOk === true && host && port && username && password;

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
            Parse your arXiv digest emails and read papers beautifully.
          </p>
        </div>

        {loginError && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-red-900/40 border border-red-700 text-red-300 text-xs">
            {loginError}
          </div>
        )}

        {view === 'pick' && (
          <>
            {hasGoogle && (
              <>
                <button
                  onClick={loginWithGoogle}
                  disabled={isLoggingIn}
                  className="w-full flex items-center justify-center gap-3 px-6 py-3.5 rounded-xl bg-white text-slate-800 font-semibold text-sm hover:bg-slate-100 transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-lg mb-3"
                >
                  {isLoggingIn ? (
                    <svg className="animate-spin w-5 h-5 text-slate-600" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 48 48" className="w-5 h-5 shrink-0">
                      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                    </svg>
                  )}
                  {isLoggingIn ? 'Connecting…' : 'Continue with Google'}
                </button>

                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-600" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="px-2 bg-slate-800/60 text-slate-500 text-xs">or use IMAP</span>
                  </div>
                </div>
              </>
            )}

            <p className="text-slate-400 text-xs mb-3">Sign in with your email provider:</p>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(IMAP_PRESETS).map(([key, { label }]) => (
                <button
                  key={key}
                  onClick={() => { selectPreset(key as keyof typeof IMAP_PRESETS); setView('imap'); }}
                  className="px-3 py-2.5 rounded-lg bg-slate-700/70 border border-slate-600 text-slate-200 text-xs font-medium hover:bg-slate-700 hover:border-slate-500 transition-all text-center"
                >
                  {label}
                </button>
              ))}
            </div>

            <p className="mt-6 text-xs text-slate-500 text-center leading-relaxed">
              Gmail: read-only access, emails never stored on any server.
              <br />IMAP: requires running the local backend.
            </p>
          </>
        )}

        {view === 'imap' && (
          <>
            {/* Backend availability banner */}
            {backendOk === false && (
              <div className="mb-4 px-4 py-3 rounded-lg bg-amber-900/40 border border-amber-700 text-amber-300 text-xs leading-relaxed">
                Cannot reach local backend server. Run in a terminal:
                <br />
                <code className="font-mono mt-1 inline-block">npm run dev:server</code>
                <br />
                <span className="text-amber-400/70 text-[10px]">IMAP requires the backend — not available on the hosted version.</span>
              </div>
            )}
            {backendOk === null && (
              <div className="mb-4 px-4 py-2 rounded-lg bg-slate-700/40 border border-slate-600 text-slate-400 text-xs flex items-center gap-2">
                <svg className="animate-spin w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Checking backend…
              </div>
            )}

            {/* Preset tabs */}
            <div className="flex gap-1 mb-4 flex-wrap">
              {Object.entries(IMAP_PRESETS).map(([key, { label }]) => (
                <button
                  key={key}
                  onClick={() => selectPreset(key as keyof typeof IMAP_PRESETS)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    preset === key
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Credentials form */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">IMAP Host</label>
                <input
                  type="text"
                  value={host}
                  onChange={e => setHost(e.target.value)}
                  placeholder="imap.example.com"
                  className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Port</label>
                <input
                  type="number"
                  value={port}
                  onChange={e => setPort(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Email / Username</label>
                <input
                  type="email"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Password / App Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => { setView('pick'); clearError(); }}
                className="px-4 py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-700 transition-all"
              >
                Back
              </button>
              <button
                onClick={handleConnect}
                disabled={!canConnect}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Connect
              </button>
            </div>

            <p className="mt-4 text-[10px] text-slate-500 leading-relaxed text-center">
              Credentials are sent only to your local backend and never stored remotely.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
