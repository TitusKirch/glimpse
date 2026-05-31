<script lang="ts" setup>
import type { ToasterProps } from 'vue-sonner';
import { Toaster as Sonner } from 'vue-sonner';

// Mount once at the app root. Toasts are fired via `toast` from 'vue-sonner'.
// Styling follows the gildstone design: semantic colour tokens, no richColors.
const {
  theme: _ignoredTheme,
  richColors = false,
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
          'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:rounded-lg group-[.toaster]:px-4 group-[.toaster]:py-3',
        icon: 'self-start mt-0.5',
        title: 'font-medium leading-tight text-foreground',
        description:
          'mt-1 text-sm leading-relaxed group-[.toast]:text-muted-foreground',
        content: 'grid gap-0.5',
        closeButton:
          'group-[.toast]:border-border group-[.toast]:bg-background group-[.toast]:text-muted-foreground hover:group-[.toast]:text-foreground',
        actionButton:
          'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
        cancelButton:
          'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        success: '[&>[data-icon]]:text-success',
        error: '[&>[data-icon]]:text-destructive',
        warning: '[&>[data-icon]]:text-warning',
        info: '[&>[data-icon]]:text-info'
      }
    }"
  >
    <template #loading-icon>
      <NuxtIcon
        name="lucide:loader-circle"
        class="size-4 animate-spin text-muted-foreground"
      />
    </template>
    <template #success-icon>
      <NuxtIcon name="lucide:circle-check" class="size-4 text-success" />
    </template>
    <template #error-icon>
      <NuxtIcon name="lucide:circle-x" class="size-4 text-destructive" />
    </template>
    <template #warning-icon>
      <NuxtIcon name="lucide:triangle-alert" class="size-4 text-warning" />
    </template>
    <template #info-icon>
      <NuxtIcon name="lucide:info" class="size-4 text-info" />
    </template>
    <template #close-icon>
      <NuxtIcon name="lucide:x" class="size-4" />
    </template>
  </Sonner>
</template>
