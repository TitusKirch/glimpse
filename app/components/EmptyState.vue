<script setup lang="ts">
// Generic centred empty/placeholder state: icon bubble, title, optional
// description, and an optional action slot (e.g. a CTA button).
defineProps<{
  icon: string;
  title: string;
  description?: string;
}>();
</script>

<template>
  <div
    class="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
  >
    <div
      class="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground"
    >
      <NuxtIcon :name="icon" class="size-7" />
    </div>
    <div class="space-y-1">
      <p class="text-sm font-medium">{{ title }}</p>
      <p
        v-if="description"
        class="mx-auto max-w-xs text-xs text-muted-foreground"
      >
        {{ description }}
      </p>
    </div>
    <slot />
  </div>
</template>
