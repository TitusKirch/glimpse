import type { Commit } from '~/types/bindings';

type SignatureCommit = Pick<
  Commit,
  'signatureStatus' | 'signerName' | 'signerKey'
>;

// Presentation helpers for a commit's GPG/SSH signature (`%G?`). A signed commit
// shows a check after the date; the colour carries the trust level — green for a
// trusted key (`G`), amber for a good-but-untrusted/uncheckable key (`U`/`E`),
// red for a bad/expired/revoked one (`B`/`X`/`Y`/`R`). Unsigned commits (`N` or
// the empty status from the shorter log format) show nothing.
export function useCommitSignature() {
  const { t } = useI18n();

  const isSigned = (c: SignatureCommit) =>
    c.signatureStatus !== '' && c.signatureStatus !== 'N';

  const icon = (status: string) => {
    switch (status) {
      case 'G':
      case 'U':
        return 'lucide:circle-check';
      case 'B':
      case 'X':
      case 'Y':
      case 'R':
        return 'lucide:circle-x';
      default: // E and any other signed-but-uncheckable status
        return 'lucide:circle-alert';
    }
  };

  const colorClass = (status: string) => {
    switch (status) {
      case 'G':
        return 'text-green-600 dark:text-green-500';
      case 'B':
      case 'X':
      case 'Y':
      case 'R':
        return 'text-red-600 dark:text-red-500';
      default: // U, E — good or unverifiable signature, but not trusted
        return 'text-amber-600 dark:text-amber-500';
    }
  };

  // Full sentence for the tooltip / detail row. `G` names a trusted signer; `U`
  // makes the "key not verified" caveat explicit so a valid-but-untrusted
  // signature doesn't read as a plain "unverified".
  const label = (c: SignatureCommit) => {
    const signer = c.signerName || c.signerKey;
    switch (c.signatureStatus) {
      case 'G':
        return t('commit.signature.verified', { signer });
      case 'B':
      case 'X':
      case 'Y':
      case 'R':
        return t('commit.signature.invalid');
      case 'E':
        return t('commit.signature.cannotVerify');
      default: // U — good signature from an unverified key
        return t('commit.signature.untrusted', { signer });
    }
  };

  return { isSigned, icon, colorClass, label };
}
