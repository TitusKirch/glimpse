// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn(() => Promise.resolve('result'));
const isTauriMock = vi.fn(() => true);
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: isTauriMock }));

const { tauriInvoke } = await import('./tauriInvoke');
const { isTauri } = await import('./isTauri');
// tauriInvoke calls the auto-imported isTauri composable.
(globalThis as Record<string, unknown>).isTauri = isTauri;

beforeEach(() => {
  invoke.mockClear();
  isTauriMock.mockReset();
});

describe('isTauri', () => {
  it('reflects the underlying Tauri probe', () => {
    isTauriMock.mockReturnValue(true);
    expect(isTauri()).toBe(true);
    isTauriMock.mockReturnValue(false);
    expect(isTauri()).toBe(false);
  });
});

describe('tauriInvoke', () => {
  it('dispatches to invoke when under Tauri', async () => {
    isTauriMock.mockReturnValue(true);
    await expect(tauriInvoke({ command: 'cmd', args: { a: 1 } })).resolves.toBe(
      'result'
    );
    expect(invoke).toHaveBeenCalledWith('cmd', { a: 1 });
  });

  it('returns the fallback outside Tauri without calling invoke', async () => {
    isTauriMock.mockReturnValue(false);
    await expect(tauriInvoke({ command: 'cmd', fallback: 42 })).resolves.toBe(
      42
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it('returns a falsy fallback (not undefined) outside Tauri', async () => {
    isTauriMock.mockReturnValue(false);
    await expect(tauriInvoke({ command: 'cmd', fallback: '' })).resolves.toBe(
      ''
    );
  });

  it('throws outside Tauri when no fallback is given', async () => {
    isTauriMock.mockReturnValue(false);
    await expect(tauriInvoke({ command: 'cmd' })).rejects.toThrow(
      /without a fallback/
    );
  });
});
