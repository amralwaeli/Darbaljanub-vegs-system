import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { completeAccountSetup } from "../../lib/api/auth";
import { ApiError } from "../../lib/api/helpers";
import { Button, Input, Spinner } from "../../components/ui";
import { t } from "../../i18n/strings";

/**
 * Landing page for BOTH invite links and PIN-reset (recovery) links.
 * supabase-js picks the session out of the URL hash automatically
 * (detectSessionInUrl); the user then sets a display name + 6-digit PIN.
 */
export default function AcceptInvitePage() {
  const { session, profile, loading, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState(profile?.username ?? "");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="scroll-pane flex h-full flex-col items-center justify-center [&>*]:shrink-0 p-6 text-center">
        <span className="mb-3 text-4xl">✉️</span>
        <p className="max-w-sm text-gray-600">{t.inviteLinkInvalid}</p>
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const name = username.trim();
    if (!name) return setError(t.usernameRequired);
    if (!/^\d{6}$/.test(pin)) return setError(t.pinInvalid);
    if (pin !== pin2) return setError(t.pinMismatch);

    setBusy(true);
    try {
      await completeAccountSetup(name, pin);
      await refreshProfile();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.errorGeneric);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scroll-pane flex h-full flex-col items-center justify-center [&>*]:shrink-0 bg-brand-50 p-6">
      <div className="mb-6 text-center">
        <div className="mb-2 text-5xl">🥬</div>
        <h1 className="text-xl font-bold text-brand-800">
          {t.acceptInviteTitle}
        </h1>
        <p className="mt-1 text-sm text-gray-500">{session.user.email}</p>
      </div>

      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
        <Input
          label={t.username}
          required
          maxLength={40}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <Input
          label={t.choosePin}
          type="password"
          inputMode="numeric"
          maxLength={6}
          required
          className="text-center text-2xl tracking-[0.5em]"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        />
        <Input
          label={t.confirmPin}
          type="password"
          inputMode="numeric"
          maxLength={6}
          required
          className="text-center text-2xl tracking-[0.5em]"
          value={pin2}
          onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))}
        />

        {error && (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" busy={busy}>
          {t.finishSetup}
        </Button>
      </form>
    </div>
  );
}
