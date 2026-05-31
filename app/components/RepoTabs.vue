<script setup lang="ts">
import { open } from '@tauri-apps/plugin-dialog';

const repo = useRepoStore();
const { t } = useI18n();

// Native HTML5 drag-and-drop for tab reordering — no extra dependency.
const dragId = ref<string | null>(null);

async function addRepo() {
  if (!isTauri()) return;
  const path = await open({
    directory: true,
    multiple: false,
    title: t('actions.openRepo')
  });
  if (typeof path === 'string') await repo.openRepo(path);
}

function onDrop(targetId: string) {
  const from = dragId.value;
  dragId.value = null;
  if (!from || from === targetId) return;
  const order = [...repo.order];
  const fi = order.indexOf(from);
  const ti = order.indexOf(targetId);
  if (fi < 0 || ti < 0) return;
  order.splice(fi, 1);
  order.splice(ti, 0, from);
  repo.reorderTabs(order);
}
</script>

<template>
  <div class="flex items-center gap-1">
    <div
      v-for="tab in repo.tabs"
      :key="tab.id"
      draggable="true"
      class="group flex cursor-pointer items-center gap-2 rounded-md py-1.5 pr-1 pl-3 text-sm transition-colors"
      :class="[
        tab.id === repo.activeTabId
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/50',
        dragId === tab.id && 'opacity-50'
      ]"
      @click="repo.selectTab(tab.id)"
      @dragstart="dragId = tab.id"
      @dragend="dragId = null"
      @dragover.prevent
      @drop="onDrop(tab.id)"
    >
      <span>{{ tab.name }}</span>
      <UiBadge
        v-if="tab.flavor === 'wsl'"
        variant="secondary"
        class="text-[10px] uppercase"
      >
        {{ tab.distro || 'WSL' }}
      </UiBadge>
      <button
        class="flex size-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-background/60"
        :class="
          tab.id === repo.activeTabId
            ? 'opacity-70 hover:opacity-100'
            : 'opacity-0 group-hover:opacity-100'
        "
        :aria-label="t('actions.closeRepo')"
        @click.stop="repo.closeRepo(tab.id)"
      >
        <NuxtIcon name="lucide:x" class="size-3.5" />
      </button>
    </div>

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
