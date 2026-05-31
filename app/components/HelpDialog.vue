<script setup lang="ts">
// Lists the global keyboard shortcuts (kept in sync with useShortcuts).
const { open } = useHelpDialog();
const { t } = useI18n();

const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';

const shortcuts = computed(() => [
  { keys: [mod, 'K'], label: t('command.open') },
  { keys: [mod, '/'], label: t('help.title') },
  { keys: [mod, ','], label: t('settings.title') },
  { keys: [mod, 'B'], label: t('command.toggleSidebar') },
  { keys: [mod, '↵'], label: t('changes.commit.label') },
  { keys: [mod, '⇧', 'F'], label: t('sync.fetch') },
  { keys: [mod, '⇧', 'L'], label: t('sync.pull') },
  { keys: [mod, '⇧', 'U'], label: t('sync.push') }
]);
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent class="max-w-md">
      <UiDialogHeader>
        <UiDialogTitle>{{ t('help.title') }}</UiDialogTitle>
        <UiDialogDescription class="sr-only">
          {{ t('help.title') }}
        </UiDialogDescription>
      </UiDialogHeader>
      <ul class="space-y-1.5">
        <li
          v-for="s in shortcuts"
          :key="s.label"
          class="flex items-center justify-between gap-4 text-sm"
        >
          <span>{{ s.label }}</span>
          <span class="flex shrink-0 items-center gap-1">
            <template v-for="(k, i) in s.keys" :key="i">
              <UiKbd>{{ k }}</UiKbd>
              <span
                v-if="i < s.keys.length - 1"
                class="text-xs text-muted-foreground"
                >+</span
              >
            </template>
          </span>
        </li>
      </ul>
      <p class="mt-2 text-xs text-muted-foreground">
        {{ t('help.contextHint') }}
      </p>
    </UiDialogContent>
  </UiDialog>
</template>
