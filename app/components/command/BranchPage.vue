<script setup lang="ts">
// Nested command-palette page for a single branch verb (switch / rename /
// delete / merge). CommandPalette owns the page state, the search input and the
// keyboard back-navigation; this component only renders the branch list for the
// active mode and runs the matching repo action on select. The "← Back" item
// emits `back` (without closing the palette); every real action goes through the
// `run` prop so the palette hides before any follow-up dialog opens.
import type { Branch } from '@/types/bindings';

const props = defineProps<{
  mode: 'switch' | 'rename' | 'delete' | 'merge';
  // hide()-then-execute helper, owned by CommandPalette.
  run: (fn: () => void | Promise<void>) => void;
}>();

defineEmits<{ back: [] }>();

const repo = useRepoStore();
const { t } = useI18n();

// Switch is the only verb that targets remote branches too; rename/delete/merge
// are local-only and never apply to the currently checked-out branch.
const localBranches = computed<Branch[]>(() =>
  props.mode === 'switch'
    ? repo.branches
    : repo.branches.filter((b) => b.name !== repo.currentBranch)
);

const remoteBranches = computed<string[]>(() =>
  props.mode === 'switch' ? repo.remoteBranches : []
);

function shortRemote(remoteBranch: string): string {
  const i = remoteBranch.indexOf('/');
  return i >= 0 ? remoteBranch.slice(i + 1) : remoteBranch;
}

function onLocal(name: string) {
  switch (props.mode) {
    case 'switch':
      return props.run(() => repo.checkout(name));
    case 'rename':
      return props.run(() => repo.renameBranchPrompt(name));
    case 'delete':
      return props.run(() => repo.deleteBranch(name));
    case 'merge':
      return props.run(() => repo.merge(name));
  }
}

const heading = computed(() => {
  switch (props.mode) {
    case 'switch':
      return t('command.switchBranch');
    case 'rename':
      return t('command.renameBranch');
    case 'delete':
      return t('command.deleteBranch');
    case 'merge':
      return t('command.mergeBranch');
  }
  return '';
});
</script>

<template>
  <UiCommandGroup :heading="heading">
    <!-- Back to the root command list; does NOT close the palette. -->
    <UiCommandItem value="← back" @select="$emit('back')">
      <NuxtIcon name="lucide:arrow-left" />
      {{ t('command.back') }}
    </UiCommandItem>
  </UiCommandGroup>

  <UiCommandGroup
    v-if="localBranches.length"
    :heading="t('command.localBranches')"
  >
    <UiCommandItem
      v-for="b in localBranches"
      :key="b.name"
      :value="`branch ${b.name}`"
      @select="onLocal(b.name)"
    >
      <NuxtIcon name="lucide:git-branch" />
      {{ b.name }}
      <UiCommandShortcut v-if="b.name === repo.currentBranch">
        {{ t('command.current') }}
      </UiCommandShortcut>
    </UiCommandItem>
  </UiCommandGroup>

  <UiCommandGroup
    v-if="remoteBranches.length"
    :heading="t('command.remoteBranches')"
  >
    <UiCommandItem
      v-for="r in remoteBranches"
      :key="r"
      :value="`remote ${r}`"
      @select="run(() => repo.checkoutRemote(r))"
    >
      <NuxtIcon name="lucide:cloud" />
      {{ shortRemote(r) }}
      <span class="ml-2 truncate text-xs text-muted-foreground">{{ r }}</span>
    </UiCommandItem>
  </UiCommandGroup>
</template>
