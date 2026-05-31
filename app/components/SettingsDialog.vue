<script setup lang="ts">
const open = defineModel<boolean>('open', { required: true });
const { t } = useI18n();
const colorMode = useColorMode();

// Top navigation (one page for now). Add entries here to grow settings.
const pages = [{ key: 'appearance', icon: 'lucide:palette' }] as const;
const page = ref<(typeof pages)[number]['key']>('appearance');

const themeOptions = ['system', 'light', 'dark'] as const;
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent
      class="flex h-[88vh] w-[96vw] max-w-[96vw] flex-col gap-0 p-0"
    >
      <UiDialogHeader class="px-6 pt-5 pb-4">
        <UiDialogTitle>{{ t('settings.title') }}</UiDialogTitle>
        <UiDialogDescription class="sr-only">
          {{ t('settings.title') }}
        </UiDialogDescription>
      </UiDialogHeader>

      <!-- top navigation, then a divider -->
      <nav class="flex gap-1 px-4">
        <button
          v-for="p in pages"
          :key="p.key"
          class="flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors"
          :class="
            page === p.key
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50'
          "
          @click="page = p.key"
        >
          <NuxtIcon :name="p.icon" class="size-4 shrink-0" />
          {{ t(`settings.${p.key}.title`) }}
        </button>
      </nav>
      <div class="mt-3 border-b" />

      <!-- content -->
      <div class="min-h-0 flex-1 overflow-auto px-6 py-6">
        <section v-if="page === 'appearance'" class="max-w-2xl space-y-6">
          <div class="flex items-center justify-between gap-4">
            <div>
              <p class="text-sm font-medium">
                {{ t('settings.appearance.theme') }}
              </p>
              <p class="text-xs text-muted-foreground">
                {{ t('settings.appearance.themeHint') }}
              </p>
            </div>
            <UiSelect v-model="colorMode.preference">
              <UiSelectTrigger class="w-44">
                <UiSelectValue />
              </UiSelectTrigger>
              <UiSelectContent>
                <UiSelectItem v-for="o in themeOptions" :key="o" :value="o">
                  {{ t(`settings.appearance.${o}`) }}
                </UiSelectItem>
              </UiSelectContent>
            </UiSelect>
          </div>
        </section>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>
