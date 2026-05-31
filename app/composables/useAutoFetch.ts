// Periodic background fetch, wired once from app.vue. Driven by the appearance
// settings via vueuse's useIntervalFn (re-arms when the interval changes,
// pauses when disabled). A fetch updates each branch's behind count, which the
// pull button surfaces as a "new commits" indicator.

import { useIntervalFn } from '@vueuse/core';

export function useAutoFetch() {
  const repo = useRepoStore();
  const layout = useLayoutStore();

  const intervalMs = computed(
    () => Math.max(1, layout.autoFetchMinutes) * 60_000
  );

  const { pause, resume } = useIntervalFn(
    () => {
      if (isTauri() && repo.hasRepos && !repo.busy) void repo.sync('fetch');
    },
    intervalMs,
    { immediate: false }
  );

  watchEffect(() => {
    if (layout.autoFetch) resume();
    else pause();
  });
}
