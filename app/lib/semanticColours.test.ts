import { describe, expect, it } from 'vitest';
import { alertIconVariants, alertVariants } from '@/components/ui/alert';
import { badgeVariants } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';

/**
 * Our semantic-colour extension to shadcn, as one layer rather than three.
 *
 * Upstream ships `destructive` alone; `info`, `success` and `warning` are ours,
 * and they were added to `Alert`, `Badge` and `Button` independently — two of
 * them reaching past the theme tokens into the Tailwind palette, all three
 * with a different recipe. These are the rules that keep the three in step:
 * the colour always comes from the tokens, and how it appears follows the
 * component's role — an accent on `Alert`, a fill on `Badge`.
 */
const SEMANTIC = ['info', 'success', 'warning', 'destructive'] as const;

/** A raw Tailwind palette colour — `bg-blue-500`, `text-red-600`, … */
const PALETTE =
  /\b(?:bg|text|border|border-l|ring)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;

describe('semantic colours come from the tokens', () => {
  it.each(SEMANTIC)('Alert %s uses no palette colour', (variant) => {
    expect(alertVariants({ variant })).not.toMatch(PALETTE);
    expect(alertIconVariants({ variant })).not.toMatch(PALETTE);
  });

  it.each(SEMANTIC)('Badge %s uses no palette colour', (variant) => {
    expect(badgeVariants({ variant })).not.toMatch(PALETTE);
  });

  it('Button destructive uses no palette colour', () => {
    expect(buttonVariants({ variant: 'destructive' })).not.toMatch(PALETTE);
  });
});

describe('Alert renders a semantic colour as an accent', () => {
  it.each(SEMANTIC)('%s is a left rule on a neutral surface', (variant) => {
    const classes = alertVariants({ variant });

    // The colour is the rule…
    expect(classes).toContain('border-l-2');
    expect(classes).toContain(`border-l-${variant}`);
    // …over a surface that stays close to the page…
    expect(classes).toContain('bg-muted/30');
    // …and it never fills the panel or carries the text.
    expect(classes).not.toContain(`bg-${variant}`);
    expect(classes).not.toContain(`text-${variant}`);
  });

  it.each(SEMANTIC)('%s colours the icon', (variant) => {
    expect(alertIconVariants({ variant })).toContain(`text-${variant}`);
  });

  it('leaves the default variant neutral', () => {
    expect(alertVariants({ variant: 'default' })).not.toContain('border-l-2');
  });
});

describe('Badge renders a semantic colour as a fill', () => {
  it.each(SEMANTIC)('%s fills with its paired foreground', (variant) => {
    const classes = badgeVariants({ variant });

    expect(classes).toContain(`bg-${variant} `);
    expect(classes).toContain(`text-${variant}-foreground`);
  });
});

describe('Button keeps shadcn own variant set', () => {
  // An unknown variant contributes no classes, so it is what a dropped one
  // now looks like.
  const unknown = buttonVariants({ variant: 'not-a-variant' as never });

  it.each(['success', 'warning', 'info'])('%s is not a variant', (variant) => {
    expect(buttonVariants({ variant: variant as never })).toBe(unknown);
  });

  it('fills destructive with its paired foreground', () => {
    const classes = buttonVariants({ variant: 'destructive' });

    expect(classes).toContain('bg-destructive ');
    expect(classes).toContain('text-destructive-foreground');
  });
});
