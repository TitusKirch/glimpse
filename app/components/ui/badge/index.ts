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
        // Soft, borderless semantic tints built on the theme tokens (shared with
        // the toast/button colour set). Tinted background + matching text, no
        // hard border — readable in both light and dark.
        info: 'border-transparent bg-info/10 text-info',
        success: 'border-transparent bg-success/10 text-success',
        warning: 'border-transparent bg-warning/10 text-warning',
        destructive: 'border-transparent bg-destructive/10 text-destructive'
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
