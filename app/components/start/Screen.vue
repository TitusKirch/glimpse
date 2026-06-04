<script setup lang="ts">
// Shown when no repository tab is open: a prompt to open one plus the list of
// recently opened repositories for one-click reopen.
import { open as openDialog } from '@tauri-apps/plugin-dialog';

const repo = useRepoStore();
const recent = useRecentStore();
const settings = useSettingsStore();
const initOverlay = useOverlay('init');
const cloneOverlay = useOverlay('clone');
const { t } = useI18n();

// Recent repos shown on the start screen, capped (and never more than stored).
const recentOnPage = computed(() =>
  recent.repos.slice(
    0,
    Math.min(settings.recentReposOnPage, settings.recentReposMax)
  )
);

async function pick() {
  if (!isTauri()) return;
  const path = await openDialog({
    directory: true,
    multiple: false,
    title: t('actions.openRepo')
  });
  if (typeof path === 'string') await repo.openRepo(path);
}
</script>

<template>
  <div class="flex h-full flex-col items-center justify-center gap-6 p-8">
    <div class="flex flex-col items-center gap-2 text-center">
      <span class="text-4xl">👀</span>
      <h2 class="text-lg font-semibold">{{ t('start.title') }}</h2>
      <p class="max-w-sm text-sm text-muted-foreground">
        {{ t('start.subtitle') }}
      </p>
    </div>

    <div class="flex flex-wrap items-center justify-center gap-2">
      <UiButton icon="lucide:folder-open" @click="pick">
        {{ t('actions.openRepo') }}
      </UiButton>
      <UiButton
        variant="outline"
        icon="lucide:folder-plus"
        @click="initOverlay.show()"
      >
        {{ t('actions.initRepo') }}
      </UiButton>
      <UiButton
        variant="outline"
        icon="lucide:cloud-download"
        @click="cloneOverlay.show()"
      >
        {{ t('actions.cloneRepo') }}
      </UiButton>
    </div>

    <div v-if="recent.repos.length" class="w-full max-w-md">
      <div class="mb-2 flex items-center justify-between px-1">
        <h3
          class="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {{ t('start.recent') }}
        </h3>
        <UiButton variant="ghost" size="sm" @click="recent.clear()">
          {{ t('start.clear') }}
        </UiButton>
      </div>
      <ul class="space-y-1">
        <li v-for="r in recentOnPage" :key="r.path">
          <button
            class="group flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
            @click="repo.openRepo(r.path)"
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
  </div>
</template>
