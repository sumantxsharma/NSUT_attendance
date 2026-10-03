import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { can as canRole, type Permission } from '@nsut/shared';
import { api, ApiError, setUnauthorizedHandler } from './api';
import type { Me, PublicSettings } from './types';

interface AuthState {
  me: Me['user'] | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<Me['user']>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (p: Permission) => boolean;
  sessionExpired: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me['user'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const qc = useQueryClient();

  const refresh = useCallback(async () => {
    try {
      const r = await api.get<Me>('/auth/me');
      setMe(r.user);
      setSessionExpired(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => setLoading(false));
    setUnauthorizedHandler(() => {
      setMe((prev) => {
        if (prev) setSessionExpired(true);
        return null;
      });
      qc.clear();
    });
  }, [refresh, qc]);

  const login = useCallback(
    async (email: string, password: string) => {
      const r = await api.post<Me>('/auth/login', { email, password });
      qc.clear();
      setMe(r.user);
      setSessionExpired(false);
      return r.user;
    },
    [qc],
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    qc.clear();
    setMe(null);
  }, [qc]);

  const value = useMemo<AuthState>(
    () => ({ me, loading, login, logout, refresh, sessionExpired, can: (p: Permission) => canRole(me?.role, p) }),
    [me, loading, login, logout, refresh, sessionExpired],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

export function usePublicSettings() {
  return useQuery({ queryKey: ['public-settings'], queryFn: () => api.get<PublicSettings>('/settings/public'), staleTime: 5 * 60_000 });
}

/** Institutional timezone (falls back to Asia/Kolkata while loading). */
export function useTz() {
  const { data } = usePublicSettings();
  return data?.timezone ?? 'Asia/Kolkata';
}

export function useDateFormat() {
  const { data } = usePublicSettings();
  return data?.dateFormat ?? 'dd MMM yyyy';
}
