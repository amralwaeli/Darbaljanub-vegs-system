import { useState, type FormEvent } from "react";
import { loginWithPin } from "../../lib/api/auth";
import { ApiError } from "../../lib/api/helpers";
import { Button, Input } from "../../components/ui";
import { digitsOnly, looksLikeEmail, normalizeEmail } from "../../lib/text";
import { t, toggleLanguage } from "../../i18n/strings";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Validated here rather than by the browser: a native `type="email"`
    // bubble speaks the BROWSER's language, not the app's, and phrases its
    // complaint in terms of characters the user cannot see. See lib/text.ts.
    const address = normalizeEmail(email);
    if (!looksLikeEmail(address)) {
      setError(t.emailInvalid);
      return;
    }
    if (!/^\d{6}$/.test(pin)) {
      setError(t.pinInvalid);
      return;
    }
    setBusy(true);
    try {
      await loginWithPin(address, pin);
      // AuthProvider picks the session up; router redirects automatically.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.loginFailed);
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  return (
    // Own scroll pane: the document is locked, so with the keyboard open this
    // is what lets the PIN field stay reachable.
    <div className="scroll-pane flex h-full flex-col items-center justify-center bg-brand-50 p-6 [&>*]:shrink-0">
      <button
        onClick={toggleLanguage}
        className="absolute top-4 end-4 min-h-10 rounded-xl px-3 text-sm font-semibold text-brand-700 active:bg-brand-100"
      >
        🌐 {t.switchLang}
      </button>
      <div className="mb-8 text-center">
        <div className="mb-2 text-6xl">🥬</div>
        <h1 className="text-2xl font-bold text-brand-800">{t.appName}</h1>
      </div>

      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
        {/*
          type="text", not type="email". The email keyboard still comes up
          (inputMode), autofill still works (autoComplete), but the browser's
          own validator is out of the loop — it was rejecting addresses typed
          on an Arabic layout and explaining why in a language and a vocabulary
          the user could not act on. dir="ltr" so the address reads left to
          right inside an otherwise RTL page while it is being typed.
        */}
        <Input
          label={t.email}
          type="text"
          dir="ltr"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(normalizeEmail(e.target.value))}
        />
        {/* digitsOnly, not replace(/\D/g, ""): JavaScript's \d is ASCII-only,
            so the old version deleted every Arabic-Indic digit as fast as the
            keyboard produced it and left the field empty. */}
        <Input
          label={t.pin}
          type="password"
          dir="ltr"
          inputMode="numeric"
          maxLength={6}
          placeholder={t.pinHint}
          autoComplete="current-password"
          className="text-center text-2xl tracking-[0.5em]"
          value={pin}
          onChange={(e) => setPin(digitsOnly(e.target.value))}
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
