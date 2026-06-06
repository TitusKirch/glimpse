<script setup lang="ts">
const colorMode = useColorMode();
const { t } = useI18n();

function toggle() {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark';
}
</script>

<template>
  <UiTooltip>
    <UiTooltipTrigger as-child>
      <UiButton
        variant="ghost"
        size="icon"
        :icon="colorMode.value === 'dark' ? 'lucide:moon' : 'lucide:sun'"
        :aria-label="t('theme.toggle')"
        @click="toggle"
      />
    </UiTooltipTrigger>
    <UiTooltipContent>{{ t('theme.toggle') }}</UiTooltipContent>
  </UiTooltip>
</template>
