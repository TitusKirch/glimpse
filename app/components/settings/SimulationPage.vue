<script setup lang="ts">
const { t, te } = useI18n();
const simulation = useSimulationStore();

// A switch's own change owns its label key; until one exists (and for anything
// registered without a translation) show the raw id rather than a key path.
function label(id: string) {
  const key = `settings.simulation.flags.${id}`;
  return te(key) ? t(key) : id;
}
</script>

<template>
  <!-- Simulation: the switches that deliberately bend the running app. They
       persist for the session, so what is currently on is stated at the top of
       the page and can be cleared in one click — a forgotten switch must never
       be mistaken for a real bug. -->
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

    <div>
      <h3
        class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {{ t('settings.simulation.switches.label') }}
      </h3>
      <p class="text-xs text-muted-foreground">
        {{ t('settings.simulation.switches.hint') }}
      </p>
    </div>
  </section>
</template>
