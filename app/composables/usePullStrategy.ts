// Promise-based pull-strategy chooser, shown when a pull can't proceed without
// the user deciding how to reconcile (e.g. --ff-only on diverged branches).
// PullStrategyDialog renders the shared state and resolves with the chosen
// strategy, or null if cancelled. The request/answer wiring is shared with
// useConfirm / usePrompt via createPromiseDialog.
import type { PullStrategy } from '~/stores/layout';

interface PullStrategyRequest {
  // The configured default, highlighted as the suggested choice.
  initial: PullStrategy;
}

const dialog = createPromiseDialog<PullStrategyRequest, PullStrategy | null>();

export function usePullStrategy() {
  return {
    request: dialog.request,
    choose: (
      opts: { initial?: PullStrategy } = {}
    ): Promise<PullStrategy | null> =>
      dialog.ask({ initial: opts.initial ?? 'merge' }),
    answer: dialog.answer
  };
}
