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
  // Google OAuth is optional — if no client ID is configured, IMAP providers
  // still work. The Google sign-in button is simply hidden in that case.
  if (CLIENT_ID) {
    return (
      <GoogleOAuthProvider clientId={CLIENT_ID}>
        <AuthProvider hasGoogle>
          <AppInner />
        </AuthProvider>
      </GoogleOAuthProvider>
    );
  }

  return (
    <AuthProvider hasGoogle={false}>
      <AppInner />
    </AuthProvider>
  );
}
