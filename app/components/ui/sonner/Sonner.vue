<script lang="ts" setup>
import type { ToasterProps } from 'vue-sonner';
import { Toaster as Sonner } from 'vue-sonner';

// Mount once at the app root. Toasts are fired via `toast` from 'vue-sonner'.
const {
  theme: _ignoredTheme,
  richColors = true,
  closeButton = true,
  duration = 5000,
  position = 'bottom-right',
  ...restProps
} = defineProps<ToasterProps>();

// Sonner needs an explicit theme; mirror the .dark class on <html>.
const theme = ref<ToasterProps['theme']>('light');
let observer: MutationObserver | null = null;
const sync = () => {
  theme.value = document.documentElement.classList.contains('dark')
    ? 'dark'
    : 'light';
};
onMounted(() => {
  sync();
  observer = new MutationObserver(sync);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class']
  });
});
onUnmounted(() => {
  observer?.disconnect();
  observer = null;
});
</script>

<template>
  <Sonner
    class="toaster group"
    :theme="theme"
    :rich-colors="richColors"
    :close-button="closeButton"
    :duration="duration"
    :position="position"
    v-bind="restProps"
    :toast-options="{
      classes: {
        toast:
          'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:rounded-lg',
        title: 'font-medium',
        description: 'group-[.toast]:text-muted-foreground',
        closeButton:
          'group-[.toast]:border-border group-[.toast]:bg-background group-[.toast]:text-muted-foreground'
      }
    }"
  >
    <template #success-icon>
      <NuxtIcon name="lucide:circle-check" class="size-4" />
    </template>
    <template #info-icon>
      <NuxtIcon name="lucide:info" class="size-4" />
    </template>
    <template #warning-icon>
      <NuxtIcon name="lucide:triangle-alert" class="size-4" />
    </template>
    <template #error-icon>
      <NuxtIcon name="lucide:octagon-x" class="size-4" />
    </template>
    <template #loading-icon>
      <NuxtIcon name="lucide:loader-circle" class="size-4 animate-spin" />
    </template>
    <template #close-icon>
      <NuxtIcon name="lucide:x" class="size-4" />
    </template>
  </Sonner>
</template>
