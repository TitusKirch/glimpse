<script setup lang="ts">
// One settings row: an i18n label (+ optional hint) on the left, and a control
// in the default slot on the right. Replaces the label/hint/control markup the
// settings dialog repeated for every toggle, input and select. The `hint` slot
// appends inline content (e.g. a refresh link) after the hint text.
defineProps<{ label: string; hint?: string }>();
const { t } = useI18n();
</script>

<template>
  <div class="flex items-center justify-between gap-4">
    <div class="min-w-0">
      <p class="text-sm font-medium">{{ t(label) }}</p>
      <p v-if="hint || $slots.hint" class="text-xs text-muted-foreground">
        <span v-if="hint">{{ t(hint) }}</span>
        <slot name="hint" />
      </p>
    </div>
    <slot />
  </div>
</template>
