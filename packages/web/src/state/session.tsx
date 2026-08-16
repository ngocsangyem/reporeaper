import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { ApiClient, type MeResponse } from '../api/client.js';

/**
 * Session state: mode, authentication state, and the token itself.
 *
 * The token lives in a ref inside this provider and nowhere else. Not
 * localStorage, not sessionStorage, not a cookie, not a global. The cost is
 * that a refresh loses it and the user re-pastes; the benefit is that a token
 * pasted into a self-hosted instance cannot outlive the tab it was typed into.
 */

export interface SessionValue {
  status: 'checking' | 'ready' | 'needs-token';
  me: MeResponse | null;
  tokenState: 'absent' | 'invalid' | 'ok';
  client: ApiClient;
  /** True when the server holds the token (local mode) — no gate needed. */
  isLocalMode: boolean;
  setToken: (token: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({
  children,
  baseUrl,
}: {
  children: React.ReactNode;
  baseUrl?: string;
}): React.JSX.Element {
  // A ref, not state: this value must never end up in a React DevTools tree
  // snapshot or a serialized state dump.
  const tokenRef = useRef<string | null>(null);

  const [status, setStatus] = useState<SessionValue['status']>('checking');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [tokenState, setTokenState] = useState<SessionValue['tokenState']>('absent');

  const handleUnauthenticated = useCallback((state: 'absent' | 'invalid') => {
    tokenRef.current = null;
    setTokenState(state);
    setStatus('needs-token');
  }, []);

  const client = useMemo(
    () =>
      new ApiClient({
        getToken: () => tokenRef.current,
        onUnauthenticated: handleUnauthenticated,
        ...(baseUrl === undefined ? {} : { baseUrl }),
      }),
    [baseUrl, handleUnauthenticated],
  );

  const refresh = useCallback(async () => {
    setStatus('checking');
    try {
      const response = await client.me();
      setMe(response);
      setTokenState(response.tokenState);
      setStatus(response.tokenState === 'ok' ? 'ready' : 'needs-token');
    } catch {
      // A proxy that cannot be reached is not an authentication problem, but
      // the gate is still the only screen that can explain it.
      setMe(null);
      setStatus('needs-token');
    }
  }, [client]);

  const setToken = useCallback(
    async (token: string) => {
      tokenRef.current = token.trim();
      await refresh();
    },
    [refresh],
  );

  const value = useMemo<SessionValue>(
    () => ({
      status,
      me,
      tokenState,
      client,
      isLocalMode: me?.mode === 'local',
      setToken,
      refresh,
    }),
    [status, me, tokenState, client, setToken, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value === null) throw new Error('useSession must be used inside a SessionProvider');
  return value;
}
