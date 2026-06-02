// Promise-based single-field form prompt, usable from store actions (module-
// level singleton). PromptDialog renders the request as a TanStack Form + Zod
// field and resolves with the entered string, or null if cancelled. Text props
// are i18n keys; `schema` validates the value (its messages are i18n keys too).
// The request/answer wiring is shared with useConfirm via createPromiseDialog.
import type { z } from 'zod';

interface PromptOptions {
  titleKey: string;
  labelKey: string;
  descriptionKey?: string;
  placeholderKey: string;
  submitKey: string;
  initial?: string;
  schema: z.ZodType<string>;
}

// What the dialog renders: a request id (so the form remounts per prompt) and a
// resolved initial value, on top of the caller's options.
interface PromptRequest extends Omit<PromptOptions, 'initial'> {
  id: number;
  initial: string;
}

const dialog = createPromiseDialog<PromptRequest, string | null>();
let seq = 0;

export function usePrompt() {
  return {
    request: dialog.request,
    prompt(opts: PromptOptions): Promise<string | null> {
      seq += 1;
      return dialog.ask({ id: seq, ...opts, initial: opts.initial ?? '' });
    },
    answer: dialog.answer
  };
}
