// A promise-based confirm dialog, usable from anywhere (including store
// actions) since the state is a module-level singleton. ConfirmDialog renders
// the shared state and resolves the pending promise. Texts are i18n keys, so
// the dialog component resolves them with the active locale.

interface ConfirmRequest {
  titleKey: string;
  descriptionKey: string;
  confirmKey: string;
  resolve: (ok: boolean) => void;
}

const request = ref<ConfirmRequest | null>(null);

export function useConfirm() {
  return {
    request,
    confirm(opts: {
      titleKey: string;
      descriptionKey: string;
      confirmKey: string;
    }): Promise<boolean> {
      return new Promise((resolve) => {
        request.value = { ...opts, resolve };
      });
    },
    answer(ok: boolean) {
      request.value?.resolve(ok);
      request.value = null;
    }
  };
}
