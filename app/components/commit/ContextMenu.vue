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
    <UiContextMenuContent>
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
        <UiContextMenuSubContent>
          <UiContextMenuItem @select="repo.reset({ hash, mode: 'soft' })">
            <NuxtIcon name="lucide:package-check" />
            <div class="flex flex-col">
              <span>{{ t('commit.resetSoft') }}</span>
              <span class="text-xs text-muted-foreground">{{
                t('commit.resetSoftHint')
              }}</span>
            </div>
          </UiContextMenuItem>
          <UiContextMenuItem @select="repo.reset({ hash, mode: 'mixed' })">
            <NuxtIcon name="lucide:file-pen" />
            <div class="flex flex-col">
              <span>{{ t('commit.resetMixed') }}</span>
              <span class="text-xs text-muted-foreground">{{
                t('commit.resetMixedHint')
              }}</span>
            </div>
          </UiContextMenuItem>
          <UiContextMenuItem
            class="text-destructive focus:text-destructive"
            @select="repo.reset({ hash, mode: 'hard' })"
          >
            <NuxtIcon name="lucide:trash-2" />
            <div class="flex flex-col">
              <span>{{ t('commit.resetHard') }}</span>
              <span class="text-xs text-muted-foreground">{{
                t('commit.resetHardHint')
              }}</span>
            </div>
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
