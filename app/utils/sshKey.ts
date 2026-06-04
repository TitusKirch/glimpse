export type SshKeyInfo = { type: string; comment: string };

// A public key line is `<type> <base64> [comment]`; surface the type + comment
// (the long base64 blob is noise in the UI). Falls back to a generic `ssh` type.
export function parseSshKeyLine(key: string): SshKeyInfo {
  const parts = key.trim().split(/\s+/);
  return {
    type: (parts[0] ?? '').replace(/^ssh-/, '') || 'ssh',
    comment: parts.slice(2).join(' ')
  };
}

// Pull the `-i <path>` argument out of a `core.sshCommand` value (the path may be
// quoted or bare). Empty string when there is no `-i`.
export function sshCommandKeyPath(cmd: string): string {
  const m = cmd.match(/-i\s+(?:"([^"]*)"|(\S+))/);
  return (m?.[1] ?? m?.[2] ?? '').trim();
}

// Build a `core.sshCommand` that authenticates with exactly one private key
// (`IdentitiesOnly=yes` stops ssh from also offering agent/other keys).
export function buildSshCommand(keyPath: string): string {
  return `ssh -i "${keyPath}" -o IdentitiesOnly=yes`;
}
