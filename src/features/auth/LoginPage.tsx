import { useState, type FormEvent } from "react";
import { loginWithPin } from "../../lib/api/auth";
import { ApiError } from "../../lib/api/helpers";
import { Button, Input } from "../../components/ui";
import { t } from "../../i18n/strings";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(pin)) {
      setError(t.pinInvalid);
      return;
    }
    setBusy(true);
    try {
      await loginWithPin(email.trim().toLowerCase(), pin);
      // AuthProvider picks the session up; router redirects automatically.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.loginFailed);
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-brand-50 p-6">
      <div className="mb-8 text-center">
        <div className="mb-2 text-6xl">🥬</div>
        <h1 className="text-2xl font-bold text-brand-800">{t.appName}</h1>
      </div>

      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
        <Input
          label={t.email}
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label={t.pin}
          type="password"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          placeholder={t.pinHint}
          autoComplete="current-password"
          required
          className="text-center text-2xl tracking-[0.5em]"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        />

        {error && (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" busy={busy}>
          {t.login}
        </Button>
      </form>
    </div>
  );
}
