import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { overlayNames, useOverlay } from './useOverlay';

/**
 * What these pin is that the overlay registry is bounded: it holds the declared
 * names and can never gain another, so its process-lifetime entries cost a fixed
 * amount however long the app runs.
 *
 * The union on `useOverlay` states that at the call site, but no typechecker
 * runs in this repo's gate (`pnpm check` is oxlint + oxfmt + cargo fmt + these
 * tests), so on its own the type is advice an editor gives and CI never asks
 * for. Hence the two halves below: the throw covers a name that reaches the
 * composable anyway, and the source scan covers the case the throw would only
 * find at runtime — a call site naming an overlay nobody declared, or building
 * its name from data.
 */
const appDir = fileURLToPath(new URL('..', import.meta.url));

// Every source file the app ships, minus this suite and the composable itself —
// both talk *about* useOverlay calls rather than making them.
function appSources(): { file: string; text: string }[] {
  return readdirSync(appDir, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.(?:ts|vue)$/.test(file) && !file.endsWith('.test.ts'))
    .filter((file) => !file.endsWith(join('composables', 'useOverlay.ts')))
    .map((file) => ({ file, text: readFileSync(join(appDir, file), 'utf8') }));
}

// The call's single argument, verbatim, so the test can judge whether it is a
// literal at all — a variable would read as a passing name to a laxer regex.
function overlayCallArguments(text: string): string[] {
  return [...text.matchAll(/useOverlay\(([^)]*)\)/g)].map((m) =>
    (m[1] ?? '').trim()
  );
}

describe('useOverlay', () => {
  it('hands every caller of a name the same overlay state', () => {
    const opener = useOverlay('settings');
    const dialog = useOverlay('settings');
    dialog.hide();
    opener.show();
    expect(dialog.open.value).toBe(true);
    opener.toggle();
    expect(dialog.open.value).toBe(false);
  });

  it('keeps each declared name on its own state', () => {
    for (const name of overlayNames) useOverlay(name).hide();
    useOverlay('help').show();
    expect(useOverlay('settings').open.value).toBe(false);
    expect(useOverlay('help').open.value).toBe(true);
    useOverlay('help').hide();
  });

  it('refuses a name the app never declared', () => {
    // The leak this composable is guarding against: a name minted from data, so
    // the registry gains an entry per repo/file/commit and never gives one back.
    // @ts-expect-error the union rejects this at the call site; the throw is the
    // backstop for anything that reaches it untyped.
    expect(() => useOverlay(`repo:${'a3f9c1'}`)).toThrow(/repo:a3f9c1/);
  });

  it('keeps every call site on a declared, constant name', () => {
    const declared = new Set<string>(overlayNames);
    const offenders = appSources().flatMap(({ file, text }) =>
      overlayCallArguments(text)
        .filter((argument) => {
          const literal = /^'([^']*)'$/.exec(argument);
          return !literal || !declared.has(literal[1] ?? '');
        })
        .map((argument) => `${file}: useOverlay(${argument})`)
    );
    expect(offenders).toEqual([]);
  });

  it('declares each name exactly once', () => {
    expect(new Set(overlayNames).size).toBe(overlayNames.length);
  });
});
