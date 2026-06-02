// A promise-based confirm dialog, usable from anywhere (including store
// actions) since the state is a module-level singleton. ConfirmDialog renders
// the shared state and resolves the pending promise. Texts are i18n keys, so
// the dialog component resolves them with the active locale; `params` are
// passed to i18n interpolation (e.g. the branch name in the description). The
// request/answer wiring is shared with usePrompt via createPromiseDialog.
interface ConfirmOptions {
  titleKey: string;
  descriptionKey: string;
  confirmKey: string;
  params?: Record<string, unknown>;
  destructive?: boolean;
}

const dialog = createPromiseDialog<ConfirmOptions, boolean>();

export function useConfirm() {
  return {
    request: dialog.request,
    confirm: (opts: ConfirmOptions): Promise<boolean> => dialog.ask(opts),
    answer: dialog.answer
  };
}
