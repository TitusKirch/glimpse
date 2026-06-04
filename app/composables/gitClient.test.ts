import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gitClient } from './gitClient';
import { gitMock } from './gitMock';

// gitClient uses `tauriInvoke` and `gitMock` as Nuxt auto-imports (free globals);
// provide them on globalThis so each method's body runs without the desktop shell
// (`gitMock` is referenced eagerly as the browser fallback).
const invoke = vi.fn(() => Promise.resolve(null));
beforeEach(() => {
  invoke.mockClear();
  (globalThis as Record<string, unknown>).tauriInvoke = invoke;
  (globalThis as Record<string, unknown>).gitMock = gitMock;
});

describe('gitClient', () => {
  it('routes every method through the tauriInvoke seam with a command string', async () => {
    const methods = Object.entries(gitClient).filter(
      ([, v]) => typeof v === 'function'
    ) as [string, (a: unknown) => Promise<unknown>][];
    // One method per backend command; we expect a good number of them.
    expect(methods.length).toBeGreaterThan(80);
    for (const [name, fn] of methods) {
      invoke.mockClear();
      await fn({});
      expect(invoke, `${name} should call tauriInvoke`).toHaveBeenCalledTimes(
        1
      );
      const arg = invoke.mock.calls[0][0] as { command: string };
      expect(typeof arg.command, `${name} command`).toBe('string');
      expect(arg.command.length).toBeGreaterThan(0);
    }
  });

  it('forwards the config command args verbatim', async () => {
    await gitClient.getConfig({
      path: '/r',
      key: 'user.name',
      scope: 'global'
    });
    expect(invoke.mock.calls[0][0]).toMatchObject({
      command: 'get_config',
      args: { path: '/r', key: 'user.name', scope: 'global' }
    });

    invoke.mockClear();
    await gitClient.setConfig({
      path: '/r',
      key: 'user.email',
      value: 'a@b.c',
      global: false
    });
    expect(invoke.mock.calls[0][0]).toMatchObject({
      command: 'set_config',
      args: { path: '/r', key: 'user.email', value: 'a@b.c', global: false }
    });

    invoke.mockClear();
    await gitClient.unsetConfig({ path: '/r', key: 'core.sshCommand' });
    expect(invoke.mock.calls[0][0]).toMatchObject({
      command: 'unset_config',
      args: { path: '/r', key: 'core.sshCommand', scope: 'local' }
    });
  });

  it('defaults getConfig scope to global and unsetConfig scope to local', async () => {
    await gitClient.getConfig({ path: '/r', key: 'k' });
    expect(
      (invoke.mock.calls[0][0] as { args: { scope: string } }).args.scope
    ).toBe('global');

    invoke.mockClear();
    await gitClient.unsetConfig({ path: '/r', key: 'k' });
    expect(
      (invoke.mock.calls[0][0] as { args: { scope: string } }).args.scope
    ).toBe('local');
  });
});
