// Turn raw git stderr into a concise, user-facing message: drop the
// `\t`-indented file lists git prints on a failed checkout/merge and the
// trailing "Aborting" line, falling back to the raw text if that leaves
// nothing. Pure string logic — the interface is the test surface.
export function cleanGitError(raw: string): string {
  return (
    raw
      .split('\n')
      .filter((l) => !l.startsWith('\t') && l.trim() !== 'Aborting')
      .join('\n')
      .trim() || raw.trim()
  );
}
