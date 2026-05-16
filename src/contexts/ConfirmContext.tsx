import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

// =========================================================================
// Public API
// =========================================================================

export interface ConfirmOptions {
  title:        string;
  message?:     string;
  confirmLabel?: string;
  cancelLabel?:  string;
  /** Marks the confirm button as destructive (red). Default: false. */
  destructive?: boolean;
  /** Visual tone for the icon. Default 'info' (or 'danger' when destructive). */
  tone?:        'info' | 'warning' | 'danger';
}

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside ConfirmProvider');
  return ctx.confirm;
}

// =========================================================================
// Provider + dialog
// =========================================================================

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, resolve });
    });
  }, []);

  const close = useCallback((ok: boolean) => {
    if (!pending) return;
    pending.resolve(ok);
    setPending(null);
  }, [pending]);

  // Keyboard shortcuts: Enter = confirm, Esc = cancel
  useEffect(() => {
    if (!pending) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Enter') { e.preventDefault(); close(true); }
      else if (e.key === 'Escape') { e.preventDefault(); close(false); }
    }
    document.addEventListener('keydown', onKey);
    // Focus the confirm button so Enter feels natural
    setTimeout(() => confirmBtnRef.current?.focus(), 30);
    return () => document.removeEventListener('keydown', onKey);
  }, [pending, close]);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {pending && (
        <Dialog pending={pending} onClose={close} confirmBtnRef={confirmBtnRef} />
      )}
    </ConfirmContext.Provider>
  );
}

function Dialog({
  pending, onClose, confirmBtnRef,
}: {
  pending: PendingConfirm;
  onClose: (ok: boolean) => void;
  confirmBtnRef: React.MutableRefObject<HTMLButtonElement | null>;
}) {
  const tone = pending.tone ?? (pending.destructive ? 'danger' : 'info');
  const tones = {
    info:    { ring: 'bg-blue-100',   icon: <Info        size={20} className="text-blue-600"  /> },
    warning: { ring: 'bg-amber-100',  icon: <AlertCircle size={20} className="text-amber-600" /> },
    danger:  { ring: 'bg-red-100',    icon: <AlertTriangle size={20} className="text-red-600" /> },
  }[tone];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${tones.ring}`}>
              {tones.icon}
            </div>
            <div className="flex-1 min-w-0">
              <h2 id="confirm-title" className="text-base font-semibold text-slate-900">{pending.title}</h2>
              {pending.message && (
                <p className="text-sm text-slate-600 mt-1.5 leading-relaxed whitespace-pre-line">{pending.message}</p>
              )}
            </div>
            <button
              onClick={() => onClose(false)}
              aria-label="Close"
              className="p-1 -m-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
          <button
            onClick={() => onClose(false)}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            {pending.cancelLabel ?? 'Cancel'}
          </button>
          <button
            ref={confirmBtnRef}
            onClick={() => onClose(true)}
            className={`px-4 py-2 text-sm font-medium rounded-lg shadow-sm transition-colors ${
              pending.destructive
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {pending.confirmLabel ?? (pending.destructive ? 'Delete' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
