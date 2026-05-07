import { GoogleOAuthProvider } from '@react-oauth/google';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { PapersProvider } from './contexts/PapersContext';
import LoginPage from './components/LoginPage';
import AppLayout from './components/AppLayout';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

// useGoogleLogin() inside AuthProvider always needs GoogleOAuthProvider in the
// tree. We always render it — a placeholder is used when no client ID is set
// so the hook stays valid. The Google button is only shown when CLIENT_ID exists.
const PROVIDER_ID = CLIENT_ID || 'not-configured';

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
    <LoginPage hasGoogle={!!CLIENT_ID} />
  );
}

export default function App() {
  return (
    <GoogleOAuthProvider clientId={PROVIDER_ID}>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </GoogleOAuthProvider>
  );
}
