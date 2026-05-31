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
      <UiButton variant="ghost" size="icon" @click="toggle">
        <NuxtIcon
          v-if="colorMode.value === 'dark'"
          name="lucide:moon"
          class="size-4"
        />
        <NuxtIcon v-else name="lucide:sun" class="size-4" />
      </UiButton>
    </UiTooltipTrigger>
    <UiTooltipContent>{{ t('theme.toggle') }}</UiTooltipContent>
  </UiTooltip>
</template>
