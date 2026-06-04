<script setup lang="ts">
// Right-click menu for a commit row: checkout, branch/tag here, cherry-pick,
// revert, reset (soft/mixed/hard), copy hash. Wraps the row via the default
// slot as the trigger.
import { save } from '@tauri-apps/plugin-dialog';

const props = defineProps<{ hash: string }>();

const repo = useRepoStore();
const { t } = useI18n();
const copyText = useCopy();
const rebasePlan = useRebasePlan();
const compare = useCompare();

// Export this commit to a .patch file the user picks.
async function exportPatch() {
  const dest = await save({
    defaultPath: `${props.hash.slice(0, 7)}.patch`,
    filters: [{ name: 'Patch', extensions: ['patch'] }]
  });
  if (dest) await repo.exportPatch({ hash: props.hash, dest });
}

// When several commits are multi-selected (and this row is one of them), the
// cherry-pick / revert actions operate on the whole selection.
const bulk = computed(
  () => repo.multiSel.length > 1 && repo.multiSel.includes(props.hash)
);
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

      <template v-if="bulk">
        <UiContextMenuItem @select="repo.cherryPickSelected()">
          <NuxtIcon name="lucide:cherry" />
          {{ t('commit.cherryPickN', { n: repo.multiSel.length }) }}
        </UiContextMenuItem>
        <UiContextMenuItem @select="repo.revertSelected()">
          <NuxtIcon name="lucide:undo-2" />
          {{ t('commit.revertN', { n: repo.multiSel.length }) }}
        </UiContextMenuItem>
        <UiContextMenuItem
          v-if="repo.multiSel.length === 2"
          @select="compare.compareRefs(repo.multiSel[0]!, repo.multiSel[1]!)"
        >
          <NuxtIcon name="lucide:arrow-right-left" />
          {{ t('compare.selected') }}
        </UiContextMenuItem>
      </template>
      <template v-else>
        <UiContextMenuItem @select="repo.cherryPick(hash)">
          <NuxtIcon name="lucide:cherry" />
          {{ t('commit.cherryPick') }}
        </UiContextMenuItem>
        <UiContextMenuItem @select="repo.revert(hash)">
          <NuxtIcon name="lucide:undo-2" />
          {{ t('commit.revert') }}
        </UiContextMenuItem>
      </template>
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
      <UiContextMenuItem @select="rebasePlan.show(hash)">
        <NuxtIcon name="lucide:list-ordered" />
        {{ t('rebasePlan.menu') }}
      </UiContextMenuItem>

      <UiContextMenuSeparator />

      <UiContextMenuItem @select="exportPatch">
        <NuxtIcon name="lucide:file-down" />
        {{ t('patch.export') }}
      </UiContextMenuItem>
      <UiContextMenuItem @select="copyText(hash)">
        <NuxtIcon name="lucide:copy" />
        {{ t('commit.copyHash') }}
      </UiContextMenuItem>
    </UiContextMenuContent>
  </UiContextMenu>
</template>
