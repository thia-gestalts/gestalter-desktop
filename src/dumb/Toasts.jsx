import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';

const ToastContext = createContext(null);

// toast(message, { action: { label, run }, error, duration })
// Toasts close themselves after `duration` ms (paused while hovered) and can always be closed by hand.
// An action's run may be async; if it throws, the toast is replaced by an error toast.
export function useToast() {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error('useToast needs a ToastProvider.');
  return toast;
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const close = useCallback((id) => setToasts((all) => all.filter((entry) => entry.id !== id)), []);
  const toast = useCallback((message, { action, error = false, duration = action ? 8000 : 5000 } = {}) => {
    const id = crypto.randomUUID();
    setToasts((all) => [...all.slice(-4), { id, message, action, error, duration }]);
    return id;
  }, []);
  const value = useMemo(() => ({ toast, close }), [toast, close]);
  return <ToastContext.Provider value={value}>
    {children}
    <ol className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      aria-label="Notifications">
      {toasts.map((entry) => <Toast key={entry.id} {...entry} toast={toast} dismiss={close} />)}
    </ol>
  </ToastContext.Provider>;
}

function Toast({ id, message, action, error, duration, toast, dismiss }) {
  const close = useCallback(() => dismiss(id), [dismiss, id]);
  const [paused, setPaused] = useState(false);
  const [running, setRunning] = useState(false);
  const left = useRef(duration);
  useEffect(() => {
    if (paused || running) return;
    const started = Date.now();
    const timer = setTimeout(close, left.current);
    return () => {
      clearTimeout(timer);
      left.current -= Date.now() - started;
    };
  }, [paused, running, close]);
  const act = async () => {
    setRunning(true);
    try {
      await action.run();
    } catch (failure) {
      toast(failure.message, { error: true });
    }
    close();
  };
  return <li role={error ? 'alert' : 'status'} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
    className={`pointer-events-auto flex items-center gap-2 rounded-md border bg-base-100 py-2 ps-3 pe-2 text-sm shadow-lg ${
      error ? 'border-error/40 text-error' : 'border-base-300'}`}>
    <span className="min-w-0 flex-1 wrap-break-word">{message}</span>
    {action && <button type="button" className="btn btn-sm" disabled={running} onClick={act}>{action.label}</button>}
    <button type="button" className="btn btn-ghost btn-square btn-sm" aria-label="Close notification" onClick={close}>
      <X size={16} />
    </button>
  </li>;
}
