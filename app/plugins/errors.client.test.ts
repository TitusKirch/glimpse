// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The plugin reads `defineNuxtPlugin` and `showError` as Nuxt auto-imports (free
// globals); provide them so the module body runs headless. vue-sonner is the one
// real import, mocked at the module boundary because a toast needs a mounted
// <Toaster> the plugin has no business knowing about.
const error = vi.fn();
vi.mock('vue-sonner', () => ({
  toast: { error: (...a: unknown[]) => error(...a) }
}));

const shown: unknown[] = [];
const listen = vi.spyOn(window, 'addEventListener');

const contexts: number[] = [];

function nuxtApp() {
  return {
    vueApp: { config: {} as { errorHandler?: (e: unknown) => void } },
    runWithContext: (fn: () => unknown) => {
      contexts.push(1);
      return fn();
    },
    $i18n: { t: (key: string) => key }
  };
}

beforeEach(() => {
  error.mockClear();
  listen.mockClear();
  shown.length = 0;
  contexts.length = 0;
  vi.resetModules();
  const g = globalThis as Record<string, unknown>;
  g.defineNuxtPlugin = (setup: unknown) => setup;
  g.showError = (e: unknown) => void shown.push(e);
});

async function run(app = nuxtApp()) {
  const mod = (await import('./errors.client')) as {
    default: (app: ReturnType<typeof nuxtApp>) => void;
  };
  mod.default(app);
  const call = listen.mock.calls.find(
    ([type]) => type === 'unhandledrejection'
  );
  return {
    app,
    rejected: call?.[1] as ((e: PromiseRejectionEvent) => void) | undefined
  };
}

function rejection(reason: unknown) {
  const prevented = vi.fn();
  return {
    event: {
      reason,
      preventDefault: prevented
    } as unknown as PromiseRejectionEvent,
    prevented
  };
}

describe('errors plugin', () => {
  it('surfaces an unhandled rejection instead of losing it to the console', async () => {
    const { rejected } = await run();
    expect(rejected).toBeTypeOf('function');
    const { event, prevented } = rejection(new Error('fetch blew up'));
    rejected!(event);
    expect(prevented).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toBe('error.unhandled.title');
    expect(error.mock.calls[0][1]).toMatchObject({
      description: 'fetch blew up'
    });
  });

  it('describes a rejection that carries no Error', async () => {
    const { rejected } = await run();
    rejected!(rejection('just a string').event);
    expect(error.mock.calls[0][1]).toMatchObject({
      description: 'just a string'
    });
  });

  it('leaves the app standing — a rejection is not a fatal error', async () => {
    const { rejected } = await run();
    rejected!(rejection(new Error('boom')).event);
    expect(shown).toHaveLength(0);
  });

  it('hands an error Vue could not render through to the fatal error page', async () => {
    const { app } = await run();
    const handler = app.vueApp.config.errorHandler;
    expect(handler).toBeTypeOf('function');
    const err = new Error('render blew up');
    handler!(err);
    expect(shown).toEqual([err]);
    // The rendered tree is gone; a toast would be painted onto a broken app.
    expect(error).not.toHaveBeenCalled();
  });

  it('shows the fatal page from inside the Nuxt context it needs', async () => {
    const { app } = await run();
    app.vueApp.config.errorHandler!(new Error('boom'));
    expect(contexts).toHaveLength(1);
  });
});
