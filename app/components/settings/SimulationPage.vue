<script setup lang="ts">
const { t, te } = useI18n();
const simulation = useSimulationStore();

// The switch groups, from the one place that names them — bound into setup so
// the template renders the shared list rather than restating it.
const groups = SIMULATION_GROUPS;

// A switch's own change owns its label key; for anything registered without a
// translation show the raw id rather than a key path.
function label(id: string) {
  const key = `settings.simulation.flags.${id}`;
  return te(key) ? t(key) : id;
}
</script>

<template>
  <!-- Simulation: the switches that deliberately bend the running app. They
       persist for the session, so what is currently on is stated at the top of
       the page and can be cleared in one click — a forgotten switch must never
       be mistaken for a real bug.

       The switches only write to the store; a plugin
       (app/plugins/gitSimulation.client.ts) is what carries the git faults
       through to the backend, so "turn everything off" works from here without
       this page having to know where each switch lands. -->
  <section class="w-full space-y-8">
    <div>
      <h3
        class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {{ t('settings.simulation.active.label') }}
      </h3>
      <p class="mb-3 text-xs text-muted-foreground">
        {{ t('settings.simulation.active.hint') }}
      </p>
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <UiBadge
          v-for="id in simulation.active"
          :key="id"
          variant="destructive"
          icon="lucide:flask-round"
        >
          {{ label(id) }}
        </UiBadge>
        <span
          v-if="!simulation.anyActive"
          class="text-xs text-muted-foreground"
        >
          {{ t('settings.simulation.none') }}
        </span>
      </div>
      <UiButton
        variant="outline"
        size="sm"
        icon="lucide:power-off"
        :disabled="!simulation.anyActive"
        @click="simulation.disableAll()"
      >
        {{ t('settings.simulation.disableAll') }}
      </UiButton>
    </div>

    <!-- One section per mechanism the switches bend, because what a switch can
         and cannot reach is what a reader needs to know before flipping it: the
         git faults stop at the git subprocess, the updater ones never leave the
         frontend. -->
    <div v-for="group in groups" :key="group.key">
      <h3
        class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {{ t(`settings.simulation.groups.${group.key}.label`) }}
      </h3>
      <p class="mb-3 text-xs text-muted-foreground">
        {{ t(`settings.simulation.groups.${group.key}.hint`) }}
      </p>
      <div class="space-y-4">
        <SettingsRow
          v-for="id in group.ids"
          :key="id"
          :label="`settings.simulation.flags.${id}`"
          :hint="`settings.simulation.hints.${id}`"
        >
          <UiSwitch
            class="shrink-0"
            :model-value="simulation.isOn(id)"
            @update:model-value="(on) => simulation.set(id, on === true)"
          />
        </SettingsRow>
      </div>
    </div>
  </section>
</template>
