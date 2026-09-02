import { cn } from '@/lib/utils';
import * as React from 'react';

// Lightweight controlled Tabs primitive. No @radix-ui dependency — this repo
// hand-authors its shadcn primitives (see card/dialog/table precedent). A simple
// context threads the active value; triggers are real <button role="tab"> with
// aria-selected + roving semantics, panels are role="tabpanel". Colors/spacing are
// token classes only (active tab = Porch-Light Amber accent underline).

interface TabsContextValue {
  value: string;
  setValue: (v: string) => void;
  baseId: string;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabs(): TabsContextValue {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error('Tabs subcomponents must be used within <Tabs>');
  return ctx;
}

export function Tabs({
  value,
  onValueChange,
  children,
  className,
}: {
  value: string;
  onValueChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const baseId = React.useId();
  const ctx = React.useMemo(
    () => ({ value, setValue: onValueChange, baseId }),
    [value, onValueChange, baseId],
  );
  return (
    <TabsContext.Provider value={ctx}>
      <div className={cn('flex flex-col gap-lg', className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-xs border-b border-border">
      {children}
    </div>
  );
}

export function TabsTrigger({ value, children }: { value: string; children: React.ReactNode }) {
  const { value: active, setValue, baseId } = useTabs();
  const selected = active === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${value}`}
      aria-selected={selected}
      aria-controls={`${baseId}-panel-${value}`}
      tabIndex={selected ? 0 : -1}
      onClick={() => setValue(value)}
      className={cn(
        '-mb-px border-b-2 border-transparent px-md py-sm text-body font-medium transition-colors',
        selected
          ? 'border-porch text-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, children }: { value: string; children: React.ReactNode }) {
  const { value: active, baseId } = useTabs();
  if (active !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-tab-${value}`}
    >
      {children}
    </div>
  );
}
