import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface ToastMsg {
  id: number;
  text: string;
  kind: "success" | "error";
}

const ToastContext = createContext<{
  success: (text: string) => void;
  error: (text: string) => void;
}>({ success: () => {}, error: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const nextId = useRef(1);

  const push = useCallback((text: string, kind: ToastMsg["kind"]) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev.slice(-2), { id, text, kind }]);
    window.setTimeout(
      () => setToasts((prev) => prev.filter((x) => x.id !== id)),
      3500,
    );
  }, []);

  const success = useCallback((text: string) => push(text, "success"), [push]);
  const error = useCallback((text: string) => push(text, "error"), [push]);

  return (
    <ToastContext.Provider value={{ success, error }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`w-full max-w-sm rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${
              toast.kind === "success" ? "bg-brand-700" : "bg-red-600"
            }`}
          >
            {toast.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
