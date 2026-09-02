import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export type EmptyStateTone = 'default' | 'muted';

export interface EmptyStateProps {
  /** Lucide icon rendered inside the soft rounded-square container. */
  icon: LucideIcon;
  /** Centered heading. */
  title: string;
  /** Centered supporting copy. */
  description: string;
  /** Optional CTA / action slot rendered below the description. */
  action?: ReactNode;
  /**
   * Visual tone. `default` uses the amber Porch accent; `muted` uses the
   * Brick destructive accent for error / danger contexts.
   */
  tone?: EmptyStateTone;
  /** Optional extra classes for the outer card. */
  className?: string;
}

/**
 * Single source of truth for every admin empty / prompt / no-results state.
 *
 * Renders a centered card with a soft tinted rounded-SQUARE icon container,
 * a display-font title, muted description and an optional action slot — matching
 * the polished empty state in the `.dc.html` design language. All screens must
 * use this component so icon container, typography and spacing stay consistent.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = 'default',
  className,
}: EmptyStateProps) {
  const toneClasses = tone === 'muted' ? 'bg-brick/10 text-brick' : 'bg-porch/10 text-porch';

  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-[12px] border border-ink/10 bg-card px-6 py-12 text-center',
        className,
      )}
    >
      <div className={cn('flex size-12 items-center justify-center rounded-xl', toneClasses)}>
        <Icon className="size-6" aria-hidden="true" />
      </div>
      <h3 className="mt-5 font-display text-heading text-ink">{title}</h3>
      <p className="mx-auto mt-2 max-w-[380px] text-body text-[#5C6B85]">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
