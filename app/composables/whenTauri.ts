// Run a side effect only inside the Tauri desktop shell — wiring native event
// listeners, reading the build version. In the browser it's a no-op returning
// undefined. The counterpart to tauriInvoke for calls that aren't the
// invoke(command, args) shape, so the bare `if (isTauri())` guard lives once.

export function whenTauri<T>(run: () => T): T | undefined {
  return isTauri() ? run() : undefined;
}
