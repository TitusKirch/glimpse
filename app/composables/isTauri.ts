// True only inside the Tauri desktop shell. In the browser (Nuxt dev demo) this
// is false, which is what flips the git layer over to its mock fallbacks.

import { isTauri as tauriIsTauri } from '@tauri-apps/api/core';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && tauriIsTauri();
}
