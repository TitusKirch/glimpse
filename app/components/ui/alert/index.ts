import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';

export { default as Alert } from './Alert.vue';
export { default as AlertDescription } from './AlertDescription.vue';
export { default as AlertTitle } from './AlertTitle.vue';

// Flex row: a leading variant icon (rendered by Alert.vue) + a content column.
// Deliberately not the shadcn grid — it hinged on a bare direct-child <svg>,
// which NuxtIcon doesn't reliably produce, collapsing the text layout.
//
// The semantic variants are ours (upstream ships `destructive` alone) and they
// render the colour as an *accent*: a thin left rule over a surface that stays
// close to the page, with the title as ordinary text. The colour never fills
// the panel and never carries text — that is what lets it come from the theme
// tokens rather than from a hand-picked palette shade legible as text.
// `Badge` and `Button` take the other half of the same rule: a solid token
// fill with its paired foreground.
export const alertVariants = cva(
  'relative flex w-full items-start gap-2.5 rounded-lg border px-4 py-3 text-sm',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        info: 'border-l-2 border-l-info bg-muted/30 text-foreground',
        success: 'border-l-2 border-l-success bg-muted/30 text-foreground',
        warning: 'border-l-2 border-l-warning bg-muted/30 text-foreground',
        destructive:
          'border-l-2 border-l-destructive bg-muted/30 text-foreground'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
);

// The accent's other half. Keyed by the same `variant` so the two cannot drift,
// and applied by Alert.vue to the icon it renders — an explicit class rather
// than a `[&>svg]` selector, because NuxtIcon may emit a CSS mask instead.
export const alertIconVariants = cva('size-4 shrink-0 translate-y-0.5', {
  variants: {
    variant: {
      default: 'text-current',
      info: 'text-info',
      success: 'text-success',
      warning: 'text-warning',
      destructive: 'text-destructive'
    }
  },
  defaultVariants: {
    variant: 'default'
  }
});

export type AlertVariants = VariantProps<typeof alertVariants>;
