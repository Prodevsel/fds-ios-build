import { cn } from '@/lib/utils';
import type * as React from 'react';

// shadcn (new-york) Skeleton — loading placeholder matching final layout
// (05-UI-SPEC: "skeleton, matching final layout — no spinner-only").
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

export { Skeleton };
