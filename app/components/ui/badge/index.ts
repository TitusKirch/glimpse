import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';

export { default as Badge } from './Badge.vue';

export const badgeVariants = cva(
  'inline-flex items-center justify-center rounded-full border font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90',
        outline:
          'text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        // Ours, not upstream's. A dense inline chip takes the *fill* half of
        // the semantic rule: a solid theme token with the foreground it is
        // paired with, so the colour is legible without the token ever
        // carrying text on its own wash. `Alert` takes the accent half.
        // The pairs are measured in `app/assets/css/contrast.test.ts`.
        info: 'border-transparent bg-info text-info-foreground [a&]:hover:bg-info/90',
        success:
          'border-transparent bg-success text-success-foreground [a&]:hover:bg-success/90',
        warning:
          'border-transparent bg-warning text-warning-foreground [a&]:hover:bg-warning/90',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground [a&]:hover:bg-destructive/90'
      },
      size: {
        // `sm` is the dense variant for the commit-graph ref badges.
        default: 'px-2 py-0.5 text-xs',
        sm: 'px-1.5 py-0 text-[10px] leading-4'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
);
export type BadgeVariants = VariantProps<typeof badgeVariants>;
