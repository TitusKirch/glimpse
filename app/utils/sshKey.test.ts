import { describe, expect, it } from 'vitest';
import { buildSshCommand, parseSshKeyLine, sshCommandKeyPath } from './sshKey';

describe('parseSshKeyLine', () => {
  it('extracts the type (without the ssh- prefix) and the comment', () => {
    expect(parseSshKeyLine('ssh-ed25519 AAAAC3Nza user@host')).toEqual({
      type: 'ed25519',
      comment: 'user@host'
    });
  });

  it('keeps a multi-word comment intact', () => {
    expect(parseSshKeyLine('ssh-rsa AAAA work laptop key')).toEqual({
      type: 'rsa',
      comment: 'work laptop key'
    });
  });

  it('returns an empty comment when there is none', () => {
    expect(parseSshKeyLine('ssh-ed25519 AAAA')).toEqual({
      type: 'ed25519',
      comment: ''
    });
  });

  it('falls back to a generic ssh type for an empty/blank line', () => {
    expect(parseSshKeyLine('').type).toBe('ssh');
    expect(parseSshKeyLine('   ').type).toBe('ssh');
  });

  it('leaves a type that does not start with ssh- untouched', () => {
    expect(parseSshKeyLine('sk-ssh-ed25519 AAAA c').type).toBe(
      'sk-ssh-ed25519'
    );
  });
});

describe('sshCommandKeyPath', () => {
  it('extracts a quoted path', () => {
    expect(
      sshCommandKeyPath(
        'ssh -i "/home/u/.ssh/id_ed25519" -o IdentitiesOnly=yes'
      )
    ).toBe('/home/u/.ssh/id_ed25519');
  });

  it('extracts a bare path', () => {
    expect(sshCommandKeyPath('ssh -i /home/u/.ssh/id_rsa')).toBe(
      '/home/u/.ssh/id_rsa'
    );
  });

  it('returns empty when there is no -i argument', () => {
    expect(sshCommandKeyPath('ssh -o IdentitiesOnly=yes')).toBe('');
    expect(sshCommandKeyPath('')).toBe('');
  });
});

describe('buildSshCommand', () => {
  it('quotes the key path and forces IdentitiesOnly', () => {
    expect(buildSshCommand('/home/u/.ssh/id_ed25519')).toBe(
      'ssh -i "/home/u/.ssh/id_ed25519" -o IdentitiesOnly=yes'
    );
  });

  it('round-trips with sshCommandKeyPath', () => {
    const p = '/home/u/.ssh/id_ed25519';
    expect(sshCommandKeyPath(buildSshCommand(p))).toBe(p);
  });
});
