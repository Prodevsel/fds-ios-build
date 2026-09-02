import type { Config } from 'tailwindcss';
import { tokens } from './src/design/tokens';

/**
 * Tailwind theme generated FROM the design-token SSOT (`src/design/tokens.ts`)
 * — there is no second literal source for colors/spacing/typography. shadcn
 * semantic colors resolve to CSS variables defined in `src/index.css` (also
 * derived from these tokens). The token-named palette (paper/ink/porch/brick/
 * pine) is exposed for the custom shell/CodeChip elements.
 */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Token-named brand palette (05-UI-SPEC) — literals live only here + index.css.
        paper: tokens.color.dominant,
        ink: tokens.color.ink,
        porch: tokens.color.accent,
        brick: tokens.color.destructive,
        pine: tokens.color.pine,
        // shadcn semantic tokens (CSS variables, defined in src/index.css).
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
      },
      fontFamily: {
        display: [tokens.typography.families.display],
        sans: [tokens.typography.families.body],
        mono: [tokens.typography.families.mono],
      },
      fontSize: {
        label: [`${tokens.typography.size.label}px`, { lineHeight: '16px' }],
        body: [`${tokens.typography.size.body}px`, { lineHeight: '20px' }],
        heading: [`${tokens.typography.size.heading}px`, { lineHeight: '24px' }],
        display: [`${tokens.typography.size.display}px`, { lineHeight: '34px' }],
      },
      spacing: {
        xs: `${tokens.spacing.xs}px`,
        sm: `${tokens.spacing.sm}px`,
        md: `${tokens.spacing.md}px`,
        lg: `${tokens.spacing.lg}px`,
        xl: `${tokens.spacing.xl}px`,
        '2xl': `${tokens.spacing['2xl']}px`,
        '3xl': `${tokens.spacing['3xl']}px`,
        sidebar: '240px',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [],
} satisfies Config;
