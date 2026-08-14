import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";
import type { Profile } from "../../lib/types";

const INACTIVITY_HOURS = Number(import.meta.env.VITE_INACTIVITY_HOURS ?? "12");
const INACTIVITY_MS = INACTIVITY_HOURS * 3600_000;
const ACTIVITY_KEY = "vegs.lastActivity";

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const userIdRef = useRef<string | null>(null);

  const loadProfile = useCallback(async (userId: string | null) => {
    if (!userId) {
      setProfile(null);
      return;
    }
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    setProfile(data ?? null);
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      userIdRef.current = data.session?.user.id ?? null;
      await loadProfile(userIdRef.current);
      if (mounted) setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      const newId = newSession?.user.id ?? null;
      if (newId !== userIdRef.current) {
        userIdRef.current = newId;
        // NOTE: async work must not run inside the callback synchronously
        // (supabase-js holds an internal lock) — defer it.
        setTimeout(() => void loadProfile(newId), 0);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  // ------------------------- inactivity auto-logout (PIN hardening) --------
  useEffect(() => {
    if (!session) return;

    const touch = () => localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
    touch();
    window.addEventListener("pointerdown", touch);
    window.addEventListener("keydown", touch);

    const interval = window.setInterval(() => {
      const last = Number(localStorage.getItem(ACTIVITY_KEY) ?? "0");
      if (last && Date.now() - last > INACTIVITY_MS) {
        void supabase.auth.signOut();
      }
    }, 60_000);

    return () => {
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
      window.clearInterval(interval);
    };
  }, [session]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const refreshProfile = useCallback(
    () => loadProfile(userIdRef.current),
    [loadProfile],
  );

  return (
    <AuthContext.Provider
      value={{ session, profile, loading, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}
