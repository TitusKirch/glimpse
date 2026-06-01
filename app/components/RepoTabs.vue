<script setup lang="ts">
const repo = useRepoStore();
const openRepoDialog = useOpenRepoDialog();
const { t } = useI18n();

// Native HTML5 drag-and-drop for tab reordering — no extra dependency.
const dragId = ref<string | null>(null);

// Map a WSL distro name to its brand icon (simple-icons), falling back to the
// generic Tux penguin when the distro isn't recognised.
function distroIcon(distro?: string): string {
  const d = (distro ?? '').toLowerCase();
  if (d.includes('ubuntu')) return 'simple-icons:ubuntu';
  if (d.includes('debian')) return 'simple-icons:debian';
  if (d.includes('arch')) return 'simple-icons:archlinux';
  if (d.includes('fedora')) return 'simple-icons:fedora';
  if (d.includes('suse')) return 'simple-icons:opensuse';
  if (d.includes('kali')) return 'simple-icons:kalilinux';
  if (d.includes('alpine')) return 'simple-icons:alpinelinux';
  if (d.includes('mint')) return 'simple-icons:linuxmint';
  return 'simple-icons:linux';
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
      <UiTooltip v-if="tab.flavor === 'wsl'">
        <UiTooltipTrigger as-child>
          <NuxtIcon
            :name="distroIcon(tab.distro)"
            class="size-3.5 shrink-0 text-muted-foreground"
          />
        </UiTooltipTrigger>
        <UiTooltipContent>{{ tab.distro || 'WSL' }}</UiTooltipContent>
      </UiTooltip>
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
        <UiButton
          variant="ghost"
          size="icon"
          class="size-7"
          icon="lucide:plus"
          @click="openRepoDialog.show()"
        />
      </UiTooltipTrigger>
      <UiTooltipContent>{{ t('actions.openRepo') }}</UiTooltipContent>
    </UiTooltip>
  </div>
</template>
