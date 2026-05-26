import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { api, authStorage, login as apiLogin } from '../api/client';
import type { LoginRequest } from '../api/client';

interface AuthUser {
  username: string;
  role: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (req: LoginRequest) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>(null!);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => authStorage.get());
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const reqInterceptor = useRef<number | null>(null);
  const resInterceptor = useRef<number | null>(null);

  const doLogout = useCallback(() => {
    authStorage.clear();
    setToken(null);
    setUser(null);
  }, []);

  // Attach / re-attach axios interceptors when token changes
  useEffect(() => {
    if (reqInterceptor.current !== null) {
      api.interceptors.request.eject(reqInterceptor.current);
    }
    reqInterceptor.current = api.interceptors.request.use(config => {
      const t = authStorage.get();
      if (t) {
        config.headers = config.headers ?? {};
        (config.headers as Record<string, string>)['Authorization'] = `Bearer ${t}`;
      }
      return config;
    });

    if (resInterceptor.current !== null) {
      api.interceptors.response.eject(resInterceptor.current);
    }
    resInterceptor.current = api.interceptors.response.use(
      r => r,
      err => {
        if (err.response?.status === 401) doLogout();
        return Promise.reject(err);
      }
    );
  }, [token, doLogout]);

  // Listen for auth:logout events dispatched by client.ts
  useEffect(() => {
    window.addEventListener('auth:logout', doLogout);
    return () => window.removeEventListener('auth:logout', doLogout);
  }, [doLogout]);

  // Validate token on mount
  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      return;
    }
    // Optimistically parse username from token payload (no external dep needed)
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        // Convert base64url (Python output: - and _) → standard base64 (+ and /) for atob()
        let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        payload += '='.repeat(-payload.length % 4);
        const decoded = JSON.parse(atob(payload));
        if (decoded.exp && decoded.exp > Date.now() / 1000) {
          setUser({ username: decoded.sub ?? 'admin', role: decoded.role ?? 'admin' });
        } else {
          doLogout();
        }
      }
    } catch {
      doLogout();
    }
    setIsLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(async (req: LoginRequest) => {
    const res = await apiLogin(req);
    authStorage.set(res.access_token);
    setToken(res.access_token);
    setUser({ username: res.username, role: 'admin' });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!token && !!user,
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
