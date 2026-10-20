import { createContext, useContext } from 'react';

export interface SessionApi {
  mode: 'personal' | 'demo';
  email: string | null;
  signOut: () => Promise<void>;
  /** Kembali ke layar pilihan mode. */
  leave: () => void;
  switchMode: (m: 'personal' | 'demo') => void;
  resetDemo: () => Promise<void>;
}

export const SessionCtx = createContext<SessionApi | null>(null);

export function useSession(): SessionApi {
  const v = useContext(SessionCtx);
  if (!v) throw new Error('SessionCtx hilang');
  return v;
}
