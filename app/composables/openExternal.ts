// Open a URL in the user's real browser. In the Tauri shell a plain
// <a target="_blank"> does nothing, so route through the opener plugin; in the
// browser dev demo fall back to window.open.
import { openUrl } from '@tauri-apps/plugin-opener';

export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    await openUrl(url);
  } else if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener');
  }
}
