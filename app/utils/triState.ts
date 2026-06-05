// A per-repo override of a boolean git setting is three-valued in the UI:
// Inherit (no local key — use the global value), On, or Off. These map to the
// git-config string: '' (unset → inherit), 'true', 'false'. One source of truth
// for the conversion, shared by the signing and conventional-commit overrides.
export type TriState = 'inherit' | 'on' | 'off';

export function toTriState(configValue: string): TriState {
  return configValue === 'true' ? 'on' : configValue ? 'off' : 'inherit';
}

// The config string for a tri-state, or null when the key should be cleared
// (Inherit → no local key, so the global value applies).
export function triStateConfig(state: TriState): string | null {
  return state === 'inherit' ? null : state === 'on' ? 'true' : 'false';
}
