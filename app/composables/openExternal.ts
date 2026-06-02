// Open a URL in the user's real browser. In the Tauri shell a plain
// <a target="_blank"> does nothing, so route through the opener plugin; in the
// browser dev demo fall back to window.open.
import { openUrl } from '@tauri-apps/plugin-opener';

export async function openExternal(url: string): Promise<void> {
  // Only ever hand http(s) URLs to the OS opener. Today every caller passes a
  // hardcoded URL, but this guard means the helper can never become a
  // `file://`/custom-scheme launch sink if a caller is later changed to pass
  // dynamic (e.g. remote-derived) input.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
  if (isTauri()) {
    await openUrl(url);
  } else if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener');
  }
}
