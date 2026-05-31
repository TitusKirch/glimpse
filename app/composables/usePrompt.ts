// Promise-based single-field form prompt, usable from store actions (module-
// level singleton). PromptDialog renders the request as a TanStack Form + Zod
// field and resolves with the entered string, or null if cancelled. Text props
// are i18n keys; `schema` validates the value (its messages are i18n keys too).
import type { z } from 'zod';

interface PromptRequest {
  id: number;
  titleKey: string;
  labelKey: string;
  descriptionKey?: string;
  placeholderKey: string;
  submitKey: string;
  initial: string;
  schema: z.ZodType<string>;
  resolve: (value: string | null) => void;
}

const request = ref<PromptRequest | null>(null);
let seq = 0;

export function usePrompt() {
  return {
    request,
    prompt(opts: {
      titleKey: string;
      labelKey: string;
      descriptionKey?: string;
      placeholderKey: string;
      submitKey: string;
      initial?: string;
      schema: z.ZodType<string>;
    }): Promise<string | null> {
      return new Promise((resolve) => {
        seq += 1;
        request.value = { id: seq, initial: '', ...opts, resolve };
      });
    },
    answer(value: string | null) {
      request.value?.resolve(value);
      request.value = null;
    }
  };
}
