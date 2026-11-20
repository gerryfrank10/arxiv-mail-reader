import { AuthProvider, useAuth } from './contexts/AuthContext';
import { PapersProvider } from './contexts/PapersContext';
import LoginPage from './components/LoginPage';
import AppLayout from './components/AppLayout';

function AppInner() {
  const { user, isRestoring } = useAuth();
  // A reset link must always open the reset form, even if another session is
  // still active in this browser.
  const hasResetToken = new URLSearchParams(window.location.search).has('token');

  if (isRestoring) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return user && !hasResetToken ? (
    <PapersProvider>
      <AppLayout />
    </PapersProvider>
  ) : (
    <LoginPage />
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}
