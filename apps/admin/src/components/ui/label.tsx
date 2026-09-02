import { cn } from '@/lib/utils';
import * as React from 'react';

// shadcn (new-york) Label — plain <label>, no radix dependency (matches the
// hand-authored primitive precedent in card.tsx / skeleton.tsx).
const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        'text-label font-medium uppercase tracking-wide text-muted-foreground',
        className,
      )}
      {...props}
    />
  ),
);
Label.displayName = 'Label';

export { Label };
