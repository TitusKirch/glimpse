import type { PullStrategy } from '~/stores/layout';

// The three pull reconcile strategies with their icon and "Pull (…)" label key,
// used by the command palette and the pull split-button dropdown. The short
// labels for the settings select and the divergence dialog live separately
// under `settings.general.pullStrategy.*`.
export const PULL_STRATEGIES: {
  value: PullStrategy;
  icon: string;
  labelKey: string;
}[] = [
  { value: 'merge', icon: 'lucide:git-merge', labelKey: 'pull.merge' },
  {
    value: 'rebase',
    icon: 'lucide:git-pull-request-arrow',
    labelKey: 'pull.rebase'
  },
  { value: 'ff-only', icon: 'lucide:fast-forward', labelKey: 'pull.ffOnly' }
];
