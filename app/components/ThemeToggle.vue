<script setup lang="ts">
import { Moon, Sun } from '@lucide/vue';

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
        <Moon v-if="colorMode.value === 'dark'" class="size-4" />
        <Sun v-else class="size-4" />
      </UiButton>
    </UiTooltipTrigger>
    <UiTooltipContent>{{ t('theme.toggle') }}</UiTooltipContent>
  </UiTooltip>
</template>
