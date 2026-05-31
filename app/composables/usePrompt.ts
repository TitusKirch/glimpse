// Promise-based text-input prompt, usable from store actions (module-level
// singleton). PromptDialog renders the request and resolves with the entered
// string, or null if cancelled. Texts are i18n keys.

interface PromptRequest {
  titleKey: string;
  placeholderKey: string;
  confirmKey: string;
  initial: string;
  resolve: (value: string | null) => void;
}

const request = ref<PromptRequest | null>(null);

export function usePrompt() {
  return {
    request,
    prompt(opts: {
      titleKey: string;
      placeholderKey: string;
      confirmKey: string;
      initial?: string;
    }): Promise<string | null> {
      return new Promise((resolve) => {
        request.value = { initial: '', ...opts, resolve };
      });
    },
    answer(value: string | null) {
      request.value?.resolve(value);
      request.value = null;
    }
  };
}
