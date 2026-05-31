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
          @click="layout.setFileView('list')"
        >
          <NuxtIcon name="lucide:list" class="size-3.5" />
        </UiButton>
      </UiTooltipTrigger>
      <UiTooltipContent>{{ t('fileView.list') }}</UiTooltipContent>
    </UiTooltip>
    <UiTooltip>
      <UiTooltipTrigger as-child>
        <UiButton
          :variant="layout.fileView === 'tree' ? 'secondary' : 'ghost'"
          size="icon"
          class="size-6"
          @click="layout.setFileView('tree')"
        >
          <NuxtIcon name="lucide:folder-tree" class="size-3.5" />
        </UiButton>
      </UiTooltipTrigger>
      <UiTooltipContent>{{ t('fileView.tree') }}</UiTooltipContent>
    </UiTooltip>
  </div>
</template>
