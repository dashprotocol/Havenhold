import { createContext, useContext, ReactNode } from 'react';
import { useSession } from '@/lib/auth-client';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  patientId: string;
  role: 'PRIMARY_CAREGIVER' | 'FAMILY_MEMBER';
}

// better-auth session.user base type extended with our additionalFields
interface BetterAuthSessionUser {
  id: string;
  name: string;
  email: string;
  patientId?: string | null;
  role?: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextValue>({ user: null, isLoading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useSession();

  const user: AuthUser | null = session?.user
    ? (() => {
        const u = session.user as unknown as BetterAuthSessionUser;
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          patientId: u.patientId ?? '',
          role: (u.role as AuthUser['role']) ?? 'FAMILY_MEMBER',
        };
      })()
    : null;

  return (
    <AuthContext.Provider value={{ user, isLoading: isPending }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
