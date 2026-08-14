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

// Staff stay signed in until they tap Logout. Auto-logout is OPT-IN: set
// VITE_INACTIVITY_HOURS to a positive number of idle hours to enable it.
//
// Parsed defensively on purpose. CI passes `${{ vars.VITE_INACTIVITY_HOURS }}`,
// which becomes an EMPTY STRING when the repo variable is unset — and `??`
// does not catch "" while Number("") is 0. That combination previously
// compiled to "log out after 0ms idle", signing everyone out every minute.
// Anything not parseable as a positive number now means "never".
const INACTIVITY_HOURS = Number.parseFloat(
  import.meta.env.VITE_INACTIVITY_HOURS ?? "",
);
const INACTIVITY_MS =
  Number.isFinite(INACTIVITY_HOURS) && INACTIVITY_HOURS > 0
    ? INACTIVITY_HOURS * 3600_000
    : 0; // 0 = disabled
const ACTIVITY_KEY = "vegs.lastActivity";

// Role + store of the last signed-in user, so a returning device can paint its
// real screen instead of a spinner while the profile round-trip runs.
// This is a RENDER HINT ONLY — never an authorization decision. Every query is
// still gated by RLS and the guard triggers, so a tampered cache grants
// nothing; it is revalidated against the server on every launch.
const PROFILE_CACHE_KEY = "vegs.profileCache";

function readCachedProfile(userId: string): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as Profile;
    return cached?.id === userId ? cached : null;
  } catch {
    return null;
  }
}

function writeCachedProfile(profile: Profile | null) {
  try {
    if (profile) {
      localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
    } else {
      localStorage.removeItem(PROFILE_CACHE_KEY);
    }
  } catch {
    /* private mode / quota — the network path still works */
  }
}

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
      writeCachedProfile(null);
      return;
    }
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    // A failed round-trip (offline, cold Supabase) must not blank the profile:
    // Protected renders a spinner forever while profile is null, which read as
    // a frozen app. Keep whatever we already have and retry on the next launch.
    if (error) return;

    setProfile(data ?? null);
    writeCachedProfile(data ?? null);
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      const userId = data.session?.user.id ?? null;
      userIdRef.current = userId;

      // Paint immediately from the cached profile when this device has one;
      // the fetch below refreshes it in the background. Only a first-ever
      // login on this device waits on the network.
      if (userId) setProfile(readCachedProfile(userId));
      setLoading(false);

      void loadProfile(userId);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      const newId = newSession?.user.id ?? null;
      if (newId !== userIdRef.current) {
        userIdRef.current = newId;
        // Same trick as launch: a device that has signed in as this user
        // before renders its screen straight away. The cache is keyed by user
        // id, so a different user on a shared device gets null and waits.
        if (newId) setProfile(readCachedProfile(newId));
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
  // Disabled unless VITE_INACTIVITY_HOURS is set: staff stay signed in until
  // they tap Logout.
  useEffect(() => {
    if (!session || INACTIVITY_MS <= 0) return;

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
    writeCachedProfile(null);
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
