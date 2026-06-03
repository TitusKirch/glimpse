<script setup lang="ts">
// Open-repository dialog: pick a folder or reopen a recent one. Mirrors the
// start screen, for adding a repo while others are already open.
import { open as openDialog } from '@tauri-apps/plugin-dialog';

const { open, hide } = useOverlay('openRepo');
const repo = useRepoStore();
const recent = useRecentStore();
const settings = useSettingsStore();
const { t } = useI18n();

// Same recent list as the start screen this dialog mirrors: capped to the
// configured on-page count (and never more than are stored).
const recentOnPage = computed(() =>
  recent.repos.slice(
    0,
    Math.min(settings.recentReposOnPage, settings.recentReposMax)
  )
);

async function pick() {
  if (!isTauri()) return;
  hide();
  const path = await openDialog({
    directory: true,
    multiple: false,
    title: t('actions.openRepo')
  });
  if (typeof path === 'string') await repo.openRepo(path);
}

async function reopen(path: string) {
  hide();
  await repo.openRepo(path);
}
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent class="max-w-md">
      <UiDialogHeader>
        <UiDialogTitle>{{ t('actions.openRepo') }}</UiDialogTitle>
        <UiDialogDescription class="sr-only">
          {{ t('actions.openRepo') }}
        </UiDialogDescription>
      </UiDialogHeader>

      <UiButton class="w-full" icon="lucide:folder-open" @click="pick">
        {{ t('actions.openRepo') }}
      </UiButton>

      <div v-if="recent.repos.length" class="min-w-0">
        <div class="mb-1 flex items-center justify-between px-1">
          <h3
            class="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
          >
            {{ t('start.recent') }}
          </h3>
          <UiButton variant="ghost" size="sm" @click="recent.clear()">
            {{ t('start.clear') }}
          </UiButton>
        </div>
        <ul class="max-h-64 space-y-1 overflow-auto">
          <li v-for="r in recentOnPage" :key="r.path">
            <button
              class="group flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
              @click="reopen(r.path)"
            >
              <NuxtIcon
                name="lucide:git-branch"
                class="size-4 shrink-0 text-muted-foreground"
              />
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium">{{ r.name }}</span>
                <span class="block truncate text-xs text-muted-foreground">{{
                  r.path
                }}</span>
              </span>
              <NuxtIcon
                name="lucide:x"
                class="ml-auto size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                @click.stop="recent.remove(r.path)"
              />
            </button>
          </li>
        </ul>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>
