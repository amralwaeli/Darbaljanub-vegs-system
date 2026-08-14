import type { ReactNode } from "react";
import { Button } from "./ui";
import { t } from "../i18n/strings";

export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal
      aria-label={title}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button
            onClick={onClose}
            aria-label={t.close}
            className="flex h-10 w-10 items-center justify-center rounded-full text-gray-400 active:bg-gray-100"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Confirmation dialog for destructive / irreversible actions. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = t.confirm,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} title={title} onClose={onCancel}>
      <p className="mb-4 text-gray-600">{message}</p>
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onCancel}>
          {t.cancel}
        </Button>
        <Button
          variant={danger ? "danger" : "primary"}
          className="flex-1"
          busy={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
