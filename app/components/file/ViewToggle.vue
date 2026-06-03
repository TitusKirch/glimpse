<script setup lang="ts">
// List vs. folder-tree toggle for the shared file lists. The choice lives in
// the (persisted) settings store, so it stays consistent everywhere.
const settings = useSettingsStore();
const { t } = useI18n();
</script>

<template>
  <div class="flex h-9 shrink-0 items-center justify-end gap-1 px-2">
    <UiTooltip>
      <UiTooltipTrigger as-child>
        <UiButton
          :variant="settings.fileView === 'list' ? 'secondary' : 'ghost'"
          size="icon"
          class="size-6"
          icon="lucide:list"
          icon-size="sm"
          @click="settings.setFileView('list')"
        />
      </UiTooltipTrigger>
      <UiTooltipContent>{{ t('fileView.list') }}</UiTooltipContent>
    </UiTooltip>
    <UiTooltip>
      <UiTooltipTrigger as-child>
        <UiButton
          :variant="settings.fileView === 'tree' ? 'secondary' : 'ghost'"
          size="icon"
          class="size-6"
          icon="lucide:folder-tree"
          icon-size="sm"
          @click="settings.setFileView('tree')"
        />
      </UiTooltipTrigger>
      <UiTooltipContent>{{ t('fileView.tree') }}</UiTooltipContent>
    </UiTooltip>
  </div>
</template>
