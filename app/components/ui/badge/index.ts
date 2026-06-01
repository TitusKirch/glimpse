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
        // Soft, borderless semantic tints: a 10% colour wash + a legible
        // 600/400 text shade (the theme tokens are tuned as solid fills and
        // read too light as text on the wash in light mode). No hard border.
        info: 'border-transparent bg-blue-500/10 text-blue-600 dark:text-blue-400',
        success:
          'border-transparent bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        warning:
          'border-transparent bg-amber-500/10 text-amber-600 dark:text-amber-400',
        destructive:
          'border-transparent bg-red-500/10 text-red-600 dark:text-red-400'
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
