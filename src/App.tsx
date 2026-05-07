import { GoogleOAuthProvider } from '@react-oauth/google';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { PapersProvider } from './contexts/PapersContext';
import LoginPage from './components/LoginPage';
import AppLayout from './components/AppLayout';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

// useGoogleLogin() inside AuthProvider always needs GoogleOAuthProvider in the
// tree or it throws. We always render the provider; hasGoogle controls whether
// the Google button is shown and the login flow is reachable.
const PROVIDER_CLIENT_ID = CLIENT_ID || 'not-configured';

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
  return (
    <GoogleOAuthProvider clientId={PROVIDER_CLIENT_ID}>
      <AuthProvider hasGoogle={!!CLIENT_ID}>
        <AppInner />
      </AuthProvider>
    </GoogleOAuthProvider>
  );
}
