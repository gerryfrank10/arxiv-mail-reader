import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
  const { login, isLoggingIn, loginError } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="w-full max-w-sm px-8 py-12 rounded-2xl bg-slate-800/60 border border-slate-700 backdrop-blur-sm shadow-2xl text-center">
        <div className="mb-6 flex justify-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/30">
            <svg viewBox="0 0 24 24" fill="none" className="w-9 h-9 text-white" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
          </div>
        </div>

        <h1 className="text-3xl font-bold text-white mb-2">arXiv Mail Reader</h1>
        <p className="text-slate-400 mb-8 text-sm leading-relaxed">
          Parse your arXiv digest emails and read papers in a beautiful interface.
        </p>

        {loginError && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-red-900/40 border border-red-700 text-red-300 text-sm">
            {loginError}
          </div>
        )}

        <button
          onClick={login}
          disabled={isLoggingIn}
          className="w-full flex items-center justify-center gap-3 px-6 py-3.5 rounded-xl bg-white text-slate-800 font-semibold text-sm hover:bg-slate-100 transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-lg"
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

        <p className="mt-6 text-xs text-slate-500 leading-relaxed">
          Requires read-only Gmail access to fetch arXiv alert emails.
          <br />Your emails are never stored on any server.
        </p>
      </div>
    </div>
  );
}
