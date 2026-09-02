import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import * as React from 'react';

// Lightweight controlled Dialog (modal). No @radix-ui dependency — this repo
// hand-authors its shadcn primitives (see card.tsx / skeleton.tsx precedent),
// and radix is not in apps/admin's dependency set. Closes on Escape and on
// backdrop click; renders a labelled dialog with a titled header. Colors/spacing
// are token classes only.

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  /** aria-label for the close (X) control (i18n copy). */
  closeLabel: string;
}

export function Dialog({ open, onClose, title, description, children, closeLabel }: DialogProps) {
  const titleId = React.useId();
  const descId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-md"
      // Backdrop click closes; clicks inside the panel are stopped below.
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className="w-full max-w-md rounded-lg border bg-card p-lg shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-lg flex items-start justify-between gap-md">
          <div className="flex flex-col gap-xs">
            <h2 id={titleId} className="font-display text-heading text-foreground">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="text-body text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="rounded-md p-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
