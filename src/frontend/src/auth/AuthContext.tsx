import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { login as apiLogin, logoutApi, getMe } from '../api/client';
import type { LoginRequest } from '../api/client';

interface AuthUser {
  username: string;
  role: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (req: LoginRequest) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>(null!);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const doLogout = useCallback(async () => {
    try { await logoutApi(); } catch { /* ignore */ }
    setUser(null);
  }, []);

  // Restore session on mount — cookie is sent automatically
  useEffect(() => {
    getMe()
      .then(u => setUser(u))
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  // Listen for 401 events dispatched by the axios interceptor
  useEffect(() => {
    const handler = () => setUser(null);
    window.addEventListener('auth:logout', handler);
    return () => window.removeEventListener('auth:logout', handler);
  }, []);

  const login = useCallback(async (req: LoginRequest) => {
    const res = await apiLogin(req);
    setUser({ username: res.username, role: 'admin' });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout: doLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
