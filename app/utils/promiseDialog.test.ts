import { describe, expect, it } from 'vitest';
import { createPromiseDialog } from './promiseDialog';

describe('createPromiseDialog', () => {
  it('starts with no pending request', () => {
    const d = createPromiseDialog<{ q: string }, boolean>();
    expect(d.request.value).toBeNull();
  });

  it('ask() stores the request and resolves via answer()', async () => {
    const d = createPromiseDialog<{ q: string }, boolean>();
    const pending = d.ask({ q: 'sure?' });
    expect(d.request.value?.q).toBe('sure?');
    d.answer(true);
    await expect(pending).resolves.toBe(true);
    // the request is cleared once answered
    expect(d.request.value).toBeNull();
  });

  it('answer() with no pending request is a no-op', () => {
    const d = createPromiseDialog<{ q: string }, boolean>();
    expect(() => d.answer(false)).not.toThrow();
    expect(d.request.value).toBeNull();
  });
});
