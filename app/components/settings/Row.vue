<script setup lang="ts">
// One settings row: an i18n label (+ optional hint) on the left, and a control
// in the default slot on the right. Replaces the label/hint/control markup the
// settings dialog repeated for every toggle, input and select.
defineProps<{ label: string; hint?: string }>();
const { t } = useI18n();
</script>

<template>
  <div class="flex items-center justify-between gap-4">
    <div class="min-w-0">
      <p class="text-sm font-medium">{{ t(label) }}</p>
      <p v-if="hint" class="text-xs text-muted-foreground">{{ t(hint) }}</p>
    </div>
    <slot />
  </div>
</template>
