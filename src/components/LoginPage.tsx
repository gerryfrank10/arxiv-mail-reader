import { useState } from 'react';
import { Eye, EyeOff, Server, ChevronLeft, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ImapConfig } from '../types';

type Step = 'pick' | 'imap';
type Preset = 'icloud' | 'outlook' | 'yahoo' | 'other';

const PRESETS: Record<Preset, { label: string; host: string; port: number; hint: string; icon: React.ReactNode }> = {
  icloud: {
    label: 'iCloud Mail',
    host: 'imap.mail.me.com',
    port: 993,
    hint: 'Use an app-specific password from appleid.apple.com (2FA must be on).',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
      </svg>
    ),
  },
  outlook: {
    label: 'Outlook / Hotmail',
    host: 'outlook.office365.com',
    port: 993,
    hint: 'Use your Microsoft account password. You may need to enable IMAP in Outlook settings.',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
        <path d="M7.88 12.04q0 .45-.11.87-.1.41-.33.74-.22.33-.58.52-.37.2-.87.2t-.85-.2q-.35-.21-.57-.55-.22-.33-.33-.75-.1-.42-.1-.86t.1-.87q.1-.43.34-.76.22-.34.59-.54.36-.2.87-.2t.86.2q.35.21.57.55.22.34.31.77.1.43.1.88zM24 12v9.38q0 .46-.33.8-.33.32-.8.32H7.13q-.46 0-.8-.33-.32-.33-.32-.8V18H1q-.41 0-.7-.3-.3-.29-.3-.7V7q0-.41.3-.7Q.58 6 1 6h6V2.55q0-.44.3-.75.3-.3.75-.3h14.85q.44 0 .75.3.3.3.3.75V12zm-7.94-4.61q-1.18 0-2.12.37-.94.38-1.6 1.06-.67.67-1.03 1.6-.35.92-.35 2.04 0 1.11.35 2.03.36.93 1.03 1.6.67.68 1.6 1.06.95.38 2.12.38 1.18 0 2.12-.38.94-.38 1.6-1.06.67-.67 1.03-1.6.35-.92.35-2.03 0-1.12-.35-2.04-.36-.93-1.03-1.6-.66-.68-1.6-1.06-.94-.37-2.12-.37z"/>
      </svg>
    ),
  },
  yahoo: {
    label: 'Yahoo Mail',
    host: 'imap.mail.yahoo.com',
    port: 993,
    hint: 'Generate an app password at security.yahoo.com if you have 2-step verification enabled.',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
        <path d="M.783 0L5.995 8.482 11.108 0H13.99L7.07 10.88V17.21H4.92V10.96L-1.959e-7 0zM20.36 0l-3.6 6.35-3.59-6.35H10.4l5.197 9.2v5.65h2.136V9.2L23 0z"/>
      </svg>
    ),
  },
  other: {
    label: 'Other IMAP',
    host: '',
    port: 993,
    hint: 'Enter your mail server details manually.',
    icon: <Server size={20} />,
  },
};

function GoogleButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-white text-slate-800 font-medium text-sm hover:bg-slate-100 transition-all disabled:opacity-60 shadow-md border border-slate-200"
    >
      <svg viewBox="0 0 48 48" className="w-5 h-5 shrink-0" xmlns="http://www.w3.org/2000/svg">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      </svg>
      {loading ? 'Connecting…' : 'Continue with Google (Gmail)'}
      {loading && <Loader2 size={14} className="animate-spin ml-auto" />}
    </button>
  );
}

export default function LoginPage() {
  const { loginWithGoogle, loginWithImap, isLoggingIn, loginError, clearError, hasGoogle } = useAuth();

  const [step, setStep] = useState<Step>('pick');
  const [preset, setPreset] = useState<Preset>('icloud');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(993);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [imapError, setImapError] = useState('');
  const [imapLoading, setImapLoading] = useState(false);

  function selectPreset(p: Preset) {
    setPreset(p);
    setHost(PRESETS[p].host);
    setPort(PRESETS[p].port);
    setImapError('');
  }

  async function handleImapSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!host || !username || !password) {
      setImapError('All fields are required.');
      return;
    }
    setImapLoading(true);
    setImapError('');

    // Test the connection by hitting the health + a quick validate
    try {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error('Backend server is not running. Start it with: npm run dev:server');
    } catch {
      setImapError('Cannot reach the local backend server. Run: npm run dev:server in a separate terminal.');
      setImapLoading(false);
      return;
    }

    const config: ImapConfig = { host, port, username, password };
    loginWithImap(config, username);
    setImapLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4">
      <div className="w-full max-w-md">
        {/* Card */}
        <div className="bg-slate-800/60 border border-slate-700 backdrop-blur-sm rounded-2xl shadow-2xl px-8 py-10">
          {/* Logo */}
          <div className="flex justify-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/30">
              <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-white" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
              </svg>
            </div>
          </div>

          {step === 'pick' ? (
            <>
              <h1 className="text-2xl font-bold text-white text-center mb-1">arXiv Mail Reader</h1>
              <p className="text-slate-400 text-sm text-center mb-7">Choose your email provider to get started.</p>

              {/* Error from Google */}
              {loginError && (
                <div className="mb-4 flex gap-2 px-3 py-2.5 rounded-lg bg-red-900/40 border border-red-700 text-red-300 text-xs">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  {loginError}
                </div>
              )}

              <div className="space-y-3">
                {/* Google — only shown when VITE_GOOGLE_CLIENT_ID is configured */}
                {hasGoogle && (
                  <>
                    <GoogleButton onClick={loginWithGoogle} loading={isLoggingIn} />
                    <div className="relative flex items-center gap-3 py-1">
                      <div className="flex-1 h-px bg-slate-700" />
                      <span className="text-xs text-slate-500">or use IMAP</span>
                      <div className="flex-1 h-px bg-slate-700" />
                    </div>
                  </>
                )}

                {!hasGoogle && (
                  <p className="text-xs text-slate-500 text-center pb-1">
                    Gmail is not configured on this deployment.{' '}
                    <a href="https://github.com/gerryfrank10/arxiv-mail-reader#2-add-your-google-oauth-client-id-as-a-secret" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Set it up →</a>
                  </p>
                )}

                {/* IMAP providers */}
                {(['icloud', 'outlook', 'yahoo', 'other'] as Preset[]).map(p => (
                  <button
                    key={p}
                    onClick={() => { selectPreset(p); setStep('imap'); clearError(); }}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-slate-700/60 border border-slate-600 text-slate-200 text-sm font-medium hover:bg-slate-700 hover:border-slate-500 transition-all"
                  >
                    <span className="text-slate-300">{PRESETS[p].icon}</span>
                    {PRESETS[p].label}
                  </button>
                ))}
              </div>

              {hasGoogle && (
                <p className="mt-6 text-xs text-slate-500 text-center leading-relaxed">
                  Gmail uses OAuth — no password needed.
                  <br />
                  IMAP providers use your email credentials locally.
                </p>
              )}
            </>
          ) : (
            <>
              {/* Back */}
              <button
                onClick={() => { setStep('pick'); setImapError(''); }}
                className="flex items-center gap-1.5 text-slate-400 hover:text-white text-xs mb-5 transition-colors"
              >
                <ChevronLeft size={14} /> Back
              </button>

              <h2 className="text-xl font-bold text-white mb-1">{PRESETS[preset].label}</h2>
              <p className="text-slate-400 text-xs mb-5 leading-relaxed">{PRESETS[preset].hint}</p>

              {/* Preset tabs */}
              <div className="flex gap-1 mb-5 bg-slate-900/50 p-1 rounded-lg">
                {(['icloud', 'outlook', 'yahoo', 'other'] as Preset[]).map(p => (
                  <button
                    key={p}
                    onClick={() => selectPreset(p)}
                    className={`flex-1 text-[11px] font-medium py-1.5 rounded-md transition-colors ${
                      preset === p ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {p === 'other' ? 'Other' : p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>

              <form onSubmit={handleImapSubmit} className="space-y-3">
                {/* Host + Port */}
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">IMAP Host</label>
                    <input
                      type="text"
                      value={host}
                      onChange={e => setHost(e.target.value)}
                      placeholder="imap.mail.me.com"
                      className="w-full bg-slate-900/60 border border-slate-600 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                    />
                  </div>
                  <div className="w-20">
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">Port</label>
                    <input
                      type="number"
                      value={port}
                      onChange={e => setPort(Number(e.target.value))}
                      className="w-full bg-slate-900/60 border border-slate-600 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                    />
                  </div>
                </div>

                {/* Username */}
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Email / Username</label>
                  <input
                    type="email"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="you@icloud.com"
                    autoComplete="email"
                    className="w-full bg-slate-900/60 border border-slate-600 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                  />
                </div>

                {/* Password */}
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    {preset === 'icloud' ? 'App-Specific Password' : 'Password'}
                  </label>
                  <div className="relative">
                    <input
                      type={showPass ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder={preset === 'icloud' ? 'xxxx-xxxx-xxxx-xxxx' : '••••••••'}
                      autoComplete="current-password"
                      className="w-full bg-slate-900/60 border border-slate-600 rounded-lg px-3 py-2 pr-9 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(v => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    >
                      {showPass ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </div>

                {/* Error */}
                {imapError && (
                  <div className="flex gap-2 px-3 py-2.5 rounded-lg bg-red-900/40 border border-red-700 text-red-300 text-xs">
                    <AlertCircle size={13} className="shrink-0 mt-0.5" />
                    {imapError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={imapLoading}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-60 mt-1"
                >
                  {imapLoading && <Loader2 size={14} className="animate-spin" />}
                  {imapLoading ? 'Connecting…' : 'Connect'}
                </button>
              </form>

              <p className="mt-4 text-[11px] text-slate-500 text-center leading-relaxed">
                Credentials are used only in the local backend server and never stored or transmitted externally.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
