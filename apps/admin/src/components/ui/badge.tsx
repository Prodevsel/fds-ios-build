import { cn } from '@/lib/utils';
import { type VariantProps, cva } from 'class-variance-authority';
import type * as React from 'react';

// shadcn (new-york) Badge. Semantic status variants map to the reserved status
// palette (pine/porch/brick) from src/design/tokens.ts — status color is ALWAYS
// paired with an icon + label by the caller (StatusBadge), never color alone
// (colorblind-safe dataviz floor). Colors resolve via token classes, no hex.
const badgeVariants = cva(
  'inline-flex items-center gap-xs rounded-md border px-sm py-xs text-label font-medium',
  {
    variants: {
      variant: {
        neutral: 'border-transparent bg-muted text-muted-foreground',
        // delivered/active — Pine Green
        active: 'border-pine/30 bg-pine/10 text-pine',
        // invited/pending — Porch-Light Amber
        invited: 'border-porch/30 bg-porch/10 text-porch',
        // removed/dead-letter — Brick Red
        removed: 'border-brick/30 bg-brick/10 text-brick',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
