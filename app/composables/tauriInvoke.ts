// The single seam over Tauri's `invoke`: inside the desktop shell it dispatches
// the Rust command over IPC; in the browser (Nuxt dev demo) it returns the given
// fallback so the UI is fully developable without the native shell. gitClient
// and the updater/version composables all cross this one seam instead of each
// restating the "am I under Tauri + what's the browser fallback" guard.

import { invoke } from '@tauri-apps/api/core';

export async function tauriInvoke<T>({
  command,
  args,
  fallback
}: {
  command: string;
  args?: Record<string, unknown>;
  fallback?: T;
}): Promise<T> {
  if (isTauri()) {
    return invoke<T>(command, args);
  }
  if (fallback !== undefined) return fallback;
  throw new Error(
    `tauriInvoke(${command}) called outside Tauri without a fallback`
  );
}
