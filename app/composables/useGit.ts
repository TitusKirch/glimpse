// Thin bridge to the Tauri backend. When running inside the desktop shell it
// invokes Rust commands over IPC; in the browser (Nuxt dev demo) it falls back
// to mock data so the UI is fully developable without the native shell.

import { invoke, isTauri as tauriIsTauri } from '@tauri-apps/api/core';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && tauriIsTauri();
}

export async function gitInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
  fallback?: T
): Promise<T> {
  if (isTauri()) {
    return invoke<T>(command, args);
  }
  if (fallback !== undefined) return fallback;
  throw new Error(
    `gitInvoke(${command}) called outside Tauri without a fallback`
  );
}
