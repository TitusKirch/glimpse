<script setup lang="ts">
// Right-click menu for a commit row: checkout, branch/tag here, cherry-pick,
// revert, reset (soft/mixed/hard), copy hash. Wraps the row via the default
// slot as the trigger.
defineProps<{ hash: string }>();

const repo = useRepoStore();
const { t } = useI18n();
const copyText = useCopy();
</script>

<template>
  <UiContextMenu>
    <UiContextMenuTrigger as-child>
      <slot />
    </UiContextMenuTrigger>
    <UiContextMenuContent class="w-60">
      <UiContextMenuItem @select="repo.checkoutCommit(hash)">
        <NuxtIcon name="lucide:git-commit-horizontal" />
        {{ t('commit.checkout') }}
      </UiContextMenuItem>
      <UiContextMenuItem @select="repo.branchAt(hash)">
        <NuxtIcon name="lucide:git-branch-plus" />
        {{ t('commit.branchHere') }}
      </UiContextMenuItem>
      <UiContextMenuItem @select="repo.tagAt(hash)">
        <NuxtIcon name="lucide:tag" />
        {{ t('commit.tagHere') }}
      </UiContextMenuItem>

      <UiContextMenuSeparator />

      <UiContextMenuItem @select="repo.cherryPick(hash)">
        <NuxtIcon name="lucide:cherry" />
        {{ t('commit.cherryPick') }}
      </UiContextMenuItem>
      <UiContextMenuItem @select="repo.revert(hash)">
        <NuxtIcon name="lucide:undo-2" />
        {{ t('commit.revert') }}
      </UiContextMenuItem>
      <UiContextMenuSub>
        <UiContextMenuSubTrigger>
          <NuxtIcon name="lucide:rotate-ccw" />
          {{ t('commit.reset') }}
        </UiContextMenuSubTrigger>
        <UiContextMenuSubContent class="w-64">
          <UiContextMenuItem @select="repo.reset(hash, 'soft')">
            {{ t('commit.resetSoft') }}
          </UiContextMenuItem>
          <UiContextMenuItem @select="repo.reset(hash, 'mixed')">
            {{ t('commit.resetMixed') }}
          </UiContextMenuItem>
          <UiContextMenuItem
            class="text-destructive focus:text-destructive"
            @select="repo.reset(hash, 'hard')"
          >
            {{ t('commit.resetHard') }}
          </UiContextMenuItem>
        </UiContextMenuSubContent>
      </UiContextMenuSub>

      <UiContextMenuSeparator />

      <UiContextMenuItem @select="copyText(hash)">
        <NuxtIcon name="lucide:copy" />
        {{ t('commit.copyHash') }}
      </UiContextMenuItem>
    </UiContextMenuContent>
  </UiContextMenu>
</template>
