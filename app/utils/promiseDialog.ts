// The shared machinery behind the app's promise-based dialog intents — confirm
// and prompt. A module-level singleton holds the pending request together with
// its resolver, so a store action can `await` the user's answer from anywhere
// while one mounted dialog component renders it. Each intent builds its own
// request shape on top; this owns only the request/answer wiring so the two
// intents don't each restate it.
import { ref, type Ref } from 'vue';

export function createPromiseDialog<Request extends object, Answer>(): {
  request: Ref<(Request & { resolve: (answer: Answer) => void }) | null>;
  ask: (request: Request) => Promise<Answer>;
  answer: (answer: Answer) => void;
} {
  const request = ref(null) as Ref<
    (Request & { resolve: (answer: Answer) => void }) | null
  >;

  return {
    request,
    ask(req) {
      return new Promise<Answer>((resolve) => {
        request.value = { ...req, resolve };
      });
    },
    answer(value) {
      request.value?.resolve(value);
      request.value = null;
    }
  };
}
