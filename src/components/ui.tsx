// Shared UI primitives — mobile-first: 48px+ touch targets everywhere.
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import { t } from "../i18n/strings";

// ------------------------------------------------------------------ Button --
type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-600 text-white active:bg-brand-700 disabled:bg-gray-300 disabled:text-gray-500",
  secondary:
    "bg-white text-brand-700 border border-brand-600 active:bg-brand-50 disabled:border-gray-300 disabled:text-gray-400",
  danger:
    "bg-red-600 text-white active:bg-red-700 disabled:bg-gray-300 disabled:text-gray-500",
  ghost: "bg-transparent text-gray-600 active:bg-gray-100",
};

export function Button({
  variant = "primary",
  busy = false,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  busy?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={`min-h-12 rounded-xl px-4 font-semibold transition-colors select-none ${variantClasses[variant]} ${className}`}
    >
      {busy ? <Spinner className="mx-auto h-5 w-5" /> : children}
    </button>
  );
}

// ------------------------------------------------------------------- Input --
export function Input({
  label,
  className = "",
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1 block text-sm font-medium text-gray-700">
          {label}
        </span>
      )}
      <input
        {...rest}
        className={`min-h-12 w-full rounded-xl border border-gray-300 bg-white px-3 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600 ${className}`}
      />
    </label>
  );
}

export function Select({
  label,
  className = "",
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1 block text-sm font-medium text-gray-700">
          {label}
        </span>
      )}
      <select
        {...rest}
        className={`min-h-12 w-full rounded-xl border border-gray-300 bg-white px-3 focus:border-brand-600 focus:outline-none ${className}`}
      >
        {children}
      </select>
    </label>
  );
}

// -------------------------------------------------------------------- Card --
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 ${className}`}
    >
      {children}
    </div>
  );
}

// ------------------------------------------------------------------- Badge --
export function Badge({
  color = "gray",
  children,
}: {
  color?: "gray" | "green" | "amber" | "blue" | "red";
  children: ReactNode;
}) {
  const colors = {
    gray: "bg-gray-100 text-gray-700",
    green: "bg-green-100 text-green-800",
    amber: "bg-amber-100 text-amber-800",
    blue: "bg-blue-100 text-blue-800",
    red: "bg-red-100 text-red-800",
  };
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${colors[color]}`}
    >
      {children}
    </span>
  );
}

// ----------------------------------------------------------------- Spinner --
export function Spinner({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin text-current ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-label={t.loading}
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

// ---------------------------------------------------------------- Skeleton --
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-20 animate-pulse rounded-2xl bg-gray-200/70"
        />
      ))}
    </div>
  );
}

// -------------------------------------------------------------- EmptyState --
export function EmptyState({
  emoji = "🥬",
  message,
}: {
  emoji?: string;
  message: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <span className="text-4xl">{emoji}</span>
      <p className="max-w-xs text-gray-500">{message}</p>
    </div>
  );
}

// --------------------------------------------------------------- PageTitle --
export function PageTitle({
  children,
  right,
}: {
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-2">
      <h1 className="text-xl font-bold text-gray-900">{children}</h1>
      {right}
    </div>
  );
}

// -------------------------------------------------------------- ErrorState --
export function ErrorState({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <span className="text-4xl">⚠️</span>
      <p className="max-w-xs text-gray-600">{message ?? t.errorGeneric}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {t.retry}
        </Button>
      )}
    </div>
  );
}
