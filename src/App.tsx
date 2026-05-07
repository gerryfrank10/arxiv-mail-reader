import { GoogleOAuthProvider } from '@react-oauth/google';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { PapersProvider } from './contexts/PapersContext';
import LoginPage from './components/LoginPage';
import AppLayout from './components/AppLayout';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

function AppInner() {
  const { user, isRestoring } = useAuth();

  if (isRestoring) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return user ? (
    <PapersProvider>
      <AppLayout />
    </PapersProvider>
  ) : (
    <LoginPage />
  );
}

export default function App() {
  if (!CLIENT_ID) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-center px-8">
        <div className="max-w-sm">
          <div className="w-14 h-14 rounded-2xl bg-red-900/40 flex items-center justify-center mx-auto mb-4">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-7 h-7 text-red-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-white mb-2">Missing configuration</h1>
          <p className="text-slate-400 text-sm leading-relaxed mb-4">
            Add your Google OAuth client ID to a <code className="text-slate-300 bg-slate-800 px-1 rounded">.env</code> file:
          </p>
          <pre className="text-left bg-slate-800 text-green-400 text-xs px-4 py-3 rounded-lg border border-slate-700">
            VITE_GOOGLE_CLIENT_ID=your-client-id
          </pre>
          <p className="text-slate-500 text-xs mt-4">See README.md for setup instructions.</p>
        </div>
      </div>
    );
  }

  return (
    <GoogleOAuthProvider clientId={CLIENT_ID}>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </GoogleOAuthProvider>
  );
}
