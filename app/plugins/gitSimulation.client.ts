// The git fault switches exist in two places at once: the simulation store the
// Settings → Developer → Simulation page drives, and a pair of statics in the
// Rust process that `Repo::run` reads on every git call. This keeps the second
// following the first.
//
// A plugin rather than the Simulation page, for two reasons:
//
//   * the store is session-only but the Rust process outlives a webview reload,
//     so after an F5 the store is empty while the backend could still be failing
//     every git call — and because nothing *changes*, no watcher on the page
//     would ever flip it back. Pushing once at startup makes the frontend
//     authoritative: whatever the store says at boot is what the backend gets;
//   * "turn everything off" has to reach the backend wherever it is clicked
//     from, not only while the page that owns the switches is mounted.
//
// Both flags are sent together because the backend holds one pair of switches;
// sending half of it would carry the other flag's stale value.
export default defineNuxtPlugin(() => {
  const simulation = useSimulationStore();
  watch(
    () => ({
      fail: simulation.isOn(SIM_GIT_FAILURE),
      slow: simulation.isOn(SIM_GIT_SLOW)
    }),
    (faults) => void gitClient.setGitSimulation(faults),
    // Immediate, because boot is the re-assert. The source reads exactly these
    // two ids, so registering a *different* simulation does not wake it.
    { immediate: true }
  );
});
