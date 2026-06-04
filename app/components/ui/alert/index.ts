import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';

export { default as Alert } from './Alert.vue';
export { default as AlertDescription } from './AlertDescription.vue';
export { default as AlertTitle } from './AlertTitle.vue';

// Flex row: a leading variant icon (rendered by Alert.vue) + a content column.
// Deliberately not the shadcn grid — it hinged on a bare direct-child <svg>,
// which NuxtIcon doesn't reliably produce, collapsing the text layout.
export const alertVariants = cva(
  'relative flex w-full items-start gap-2.5 rounded-lg border px-4 py-3 text-sm',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        destructive: 'text-destructive bg-card',
        // Soft info box: a 10% blue wash + legible 600/400 text (same palette
        // shades as the badge `info` variant, which read on the wash in both
        // light and dark).
        info: 'border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-400'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
);

export type AlertVariants = VariantProps<typeof alertVariants>;
