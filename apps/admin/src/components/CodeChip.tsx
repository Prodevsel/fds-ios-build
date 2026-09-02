import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

/**
 * CodeChip — the ONE custom, domain-specific element (05-UI-SPEC "Signature
 * element"). JetBrains Mono at the 12px Label size on a faint bordered "code
 * chip" background, reserved EXCLUSIVELY for literal partner-API/webhook
 * artifacts: API keys, webhook secrets, HMAC signatures, event IDs, deal
 * references, JSON payload previews, dead-letter error codes. Never decorative,
 * never used for prose or headings.
 */
export function CodeChip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <code
      className={cn(
        'inline-flex items-center rounded-sm border border-ink/20 bg-ink/5 px-xs py-0.5 font-mono text-label text-ink',
        className,
      )}
    >
      {children}
    </code>
  );
}
