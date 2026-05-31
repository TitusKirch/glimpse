// Applies the appearance settings that live outside the theme stylesheet:
// the accent colour (overrides the neutral --primary token) and the diff font
// scale (--mono-scale). Inline styles on <html> win over the .dark rules, so a
// chosen accent holds in both light and dark mode.

import type { Accent } from '@/stores/layout';

const ACCENTS: Record<
  Exclude<Accent, 'default'>,
  { primary: string; fg: string }
> = {
  blue: { primary: 'oklch(0.55 0.18 250)', fg: 'oklch(0.99 0 0)' },
  violet: { primary: 'oklch(0.55 0.2 290)', fg: 'oklch(0.99 0 0)' },
  green: { primary: 'oklch(0.6 0.15 150)', fg: 'oklch(0.99 0 0)' },
  amber: { primary: 'oklch(0.78 0.16 75)', fg: 'oklch(0.2 0 0)' },
  rose: { primary: 'oklch(0.6 0.2 15)', fg: 'oklch(0.99 0 0)' }
};

export const accentOptions: Accent[] = [
  'default',
  'blue',
  'violet',
  'green',
  'amber',
  'rose'
];

// Swatch colour for the settings picker (matches the applied primary).
export function accentSwatch(a: Accent): string {
  return a === 'default' ? 'oklch(0.55 0 0)' : ACCENTS[a].primary;
}

export function useAppearance() {
  const layout = useLayoutStore();

  function apply() {
    const root = document.documentElement;
    if (layout.accent === 'default') {
      root.style.removeProperty('--primary');
      root.style.removeProperty('--primary-foreground');
    } else {
      const a = ACCENTS[layout.accent];
      root.style.setProperty('--primary', a.primary);
      root.style.setProperty('--primary-foreground', a.fg);
    }
    root.style.setProperty('--mono-scale', String(layout.monoScale));
  }

  onMounted(() => {
    apply();
    watch(() => [layout.accent, layout.monoScale], apply);
  });
}
