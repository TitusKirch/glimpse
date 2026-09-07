// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The plugin uses `defineNuxtPlugin`, `isTauri` and `tauriInvoke` as Nuxt
// auto-imports (free globals); provide them so the module body runs headless.
const invoke = vi.fn(() => Promise.resolve(null));
let underTauri = true;

const listen = vi.spyOn(window, 'addEventListener');

beforeEach(() => {
  invoke.mockClear();
  listen.mockClear();
  underTauri = true;
  vi.resetModules();
  const g = globalThis as Record<string, unknown>;
  g.defineNuxtPlugin = (setup: unknown) => setup;
  g.isTauri = () => underTauri;
  g.tauriInvoke = invoke;
});

afterEach(() => {
  listen.mockClear();
});

async function run() {
  const mod = (await import('./devtools.client')) as {
    default: () => void;
  };
  mod.default();
  const call = listen.mock.calls.find(([type]) => type === 'keydown');
  return call?.[1] as ((e: KeyboardEvent) => void) | undefined;
}

function keydown(key: string) {
  const prevented = vi.fn();
  return {
    event: { key, preventDefault: prevented } as unknown as KeyboardEvent,
    prevented
  };
}

describe('devtools plugin', () => {
  it('opens the inspector on F12 inside the desktop shell', async () => {
    const handler = await run();
    expect(handler).toBeTypeOf('function');
    const { event, prevented } = keydown('F12');
    handler!(event);
    expect(prevented).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toMatchObject({
      command: 'open_devtools'
    });
  });

  it('ignores every other key', async () => {
    const handler = await run();
    const { event, prevented } = keydown('F11');
    handler!(event);
    expect(prevented).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('leaves F12 to the browser outside the desktop shell', async () => {
    underTauri = false;
    const handler = await run();
    expect(handler).toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });
});
