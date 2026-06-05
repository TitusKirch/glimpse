// The Conventional Commit types offered by the commit composer.
export const CONVENTIONAL_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert'
] as const;

const PREFIX_RE = /^[a-z]+(\([^)]*\))?!?:\s*/i;

// Apply a `type(scope)!: ` prefix to the commit subject (the first line).
// Idempotent: any existing prefix is stripped first, so re-applying never stacks
// prefixes, and the typed subject plus the rest of the message are preserved.
export function applyConventionalPrefix(
  message: string,
  {
    type,
    scope,
    breaking
  }: { type: string; scope?: string; breaking?: boolean }
): string {
  const lines = message.split('\n');
  const subject = (lines[0] ?? '').replace(PREFIX_RE, '');
  const s = (scope ?? '').trim();
  lines[0] = `${type}${s ? `(${s})` : ''}${breaking ? '!' : ''}: ${subject}`;
  return lines.join('\n');
}
