<script setup lang="ts">
// List vs. folder-tree toggle for the shared file lists. The choice lives in
// the (persisted) layout store, so it stays consistent everywhere.
const layout = useLayoutStore();
const { t } = useI18n();
</script>

<template>
  <div class="flex h-9 shrink-0 items-center justify-end gap-1 px-2">
    <UiTooltip>
      <UiTooltipTrigger as-child>
        <UiButton
          :variant="layout.fileView === 'list' ? 'secondary' : 'ghost'"
          size="icon"
          class="size-6"
          icon="lucide:list"
          icon-size="sm"
          @click="layout.setFileView('list')"
        />
      </UiTooltipTrigger>
      <UiTooltipContent>{{ t('fileView.list') }}</UiTooltipContent>
    </UiTooltip>
    <UiTooltip>
      <UiTooltipTrigger as-child>
        <UiButton
          :variant="layout.fileView === 'tree' ? 'secondary' : 'ghost'"
          size="icon"
          class="size-6"
          icon="lucide:folder-tree"
          icon-size="sm"
          @click="layout.setFileView('tree')"
        />
      </UiTooltipTrigger>
      <UiTooltipContent>{{ t('fileView.tree') }}</UiTooltipContent>
    </UiTooltip>
  </div>
</template>
