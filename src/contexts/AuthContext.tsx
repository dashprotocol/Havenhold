import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useSession } from '@/lib/auth-client';
import { fetchMe, type MeResponse, type PatientMembership } from '@/lib/api';

const STORAGE_KEY = 'havenhold.activePatientId';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  memberships: PatientMembership[];
  activePatientId: string | null;
  setActivePatientId: (id: string) => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  memberships: [],
  activePatientId: null,
  setActivePatientId: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useSession();
  const [meData, setMeData] = useState<MeResponse | null>(null);
  const [meLoading, setMeLoading] = useState(false);
  const [activePatientId, setActivePatientIdState] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.user) {
      setMeData(null);
      setActivePatientIdState(null);
      return;
    }

    setMeLoading(true);
    fetchMe()
      .then((data) => {
        setMeData(data);

        const stored = localStorage.getItem(STORAGE_KEY);
        const validStored = data.memberships.find((m) => m.patient.id === stored);
        const resolved = validStored
          ? validStored.patient.id
          : (data.memberships[0]?.patient.id ?? null);

        setActivePatientIdState(resolved);
        if (resolved) localStorage.setItem(STORAGE_KEY, resolved);
      })
      .catch(() => setMeData(null))
      .finally(() => setMeLoading(false));
  }, [session?.user?.id]);

  const setActivePatientId = (id: string) => {
    setActivePatientIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
  };

  const user: AuthUser | null = session?.user
    ? { id: session.user.id, name: session.user.name, email: session.user.email }
    : null;

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading: isPending || meLoading,
        memberships: meData?.memberships ?? [],
        activePatientId,
        setActivePatientId,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
