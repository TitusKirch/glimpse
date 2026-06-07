<script setup lang="ts">
// Repo-level in-progress banners (rebase paused / bisect running) shown above
// the Changes file list. Shared by the staged/unstaged Panel and the
// ChangelistPanel so both surface these states.
const repo = useRepoStore();
const { t } = useI18n();
</script>

<template>
  <!-- rebase paused (e.g. on a conflict): continue / skip / abort -->
  <div
    v-if="repo.rebaseInProgress"
    class="flex flex-wrap items-center gap-2 border-b bg-warning/10 px-3 py-2 text-xs"
  >
    <NuxtIcon name="lucide:git-graph" class="size-4 shrink-0 text-warning" />
    <span class="min-w-0 flex-1">{{ t('rebase.inProgress') }}</span>
    <UiButton size="sm" variant="outline" @click="repo.rebaseContinue()">
      {{ t('rebase.continue') }}
    </UiButton>
    <UiButton size="sm" variant="ghost" @click="repo.rebaseSkip()">
      {{ t('rebase.skip') }}
    </UiButton>
    <UiButton
      size="sm"
      variant="ghost"
      class="text-destructive hover:text-destructive"
      @click="repo.rebaseAbort()"
    >
      {{ t('rebase.abort') }}
    </UiButton>
  </div>

  <!-- bisect in progress: test the checked-out commit, then mark it -->
  <div
    v-if="repo.bisectInProgress"
    class="flex flex-wrap items-center gap-2 border-b bg-primary/10 px-3 py-2 text-xs"
  >
    <NuxtIcon name="lucide:bug" class="size-4 shrink-0 text-primary" />
    <span class="min-w-0 flex-1">{{ t('bisect.testing') }}</span>
    <UiButton size="sm" variant="outline" @click="repo.bisectMark('good')">
      {{ t('bisect.markGood') }}
    </UiButton>
    <UiButton size="sm" variant="outline" @click="repo.bisectMark('bad')">
      {{ t('bisect.markBad') }}
    </UiButton>
    <UiButton size="sm" variant="ghost" @click="repo.bisectMark('skip')">
      {{ t('bisect.skip') }}
    </UiButton>
    <UiButton
      size="sm"
      variant="ghost"
      class="text-destructive hover:text-destructive"
      @click="repo.bisectReset()"
    >
      {{ t('bisect.reset') }}
    </UiButton>
  </div>
</template>
