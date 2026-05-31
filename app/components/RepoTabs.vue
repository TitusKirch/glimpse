<script setup lang="ts">
import { open } from '@tauri-apps/plugin-dialog';

const repo = useRepoStore();
const { t } = useI18n();

async function addRepo() {
  if (!isTauri()) return;
  const path = await open({
    directory: true,
    multiple: false,
    title: t('actions.openRepo')
  });
  if (typeof path === 'string') await repo.openRepo(path);
}
</script>

<template>
  <div class="flex items-center gap-1">
    <button
      v-for="tab in repo.tabs"
      :key="tab.id"
      class="flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors"
      :class="
        tab.id === repo.activeTabId
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/50'
      "
      @click="repo.selectTab(tab.id)"
    >
      <span>{{ tab.name }}</span>
      <UiBadge
        v-if="tab.flavor === 'wsl'"
        variant="secondary"
        class="text-[10px] uppercase"
      >
        {{ tab.distro || 'WSL' }}
      </UiBadge>
    </button>

    <UiTooltip>
      <UiTooltipTrigger as-child>
        <UiButton variant="ghost" size="icon" class="size-7" @click="addRepo">
          <NuxtIcon name="lucide:plus" class="size-4" />
        </UiButton>
      </UiTooltipTrigger>
      <UiTooltipContent>{{ t('actions.openRepo') }}</UiTooltipContent>
    </UiTooltip>
  </div>
</template>
