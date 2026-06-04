<script setup lang="ts">
// Shared branch dropdown items (switch/rename/merge/delete), used by both the
// expanded action menu and the collapsed-sidebar dropdown.
defineProps<{ name: string }>();
const repo = useRepoStore();
const { t } = useI18n();
</script>

<template>
  <UiDropdownMenuItem
    :disabled="name === repo.currentBranch"
    @click="repo.checkout(name)"
  >
    <NuxtIcon name="lucide:check" />
    {{ t('branch.switch') }}
  </UiDropdownMenuItem>
  <UiDropdownMenuItem @click="repo.renameBranchPrompt(name)">
    <NuxtIcon name="lucide:pencil" />
    {{ t('branch.rename') }}
  </UiDropdownMenuItem>
  <UiDropdownMenuItem
    :disabled="name === repo.currentBranch"
    @click="repo.merge(name)"
  >
    <NuxtIcon name="lucide:git-merge" />
    {{ t('branch.merge') }}
  </UiDropdownMenuItem>
  <UiDropdownMenuItem
    :disabled="name === repo.currentBranch"
    @click="repo.mergeCurrentInto(name)"
  >
    <NuxtIcon name="lucide:git-merge" />
    {{ t('branch.mergeCurrentInto') }}
  </UiDropdownMenuItem>
  <UiDropdownMenuItem
    :disabled="name === repo.currentBranch"
    @click="repo.rebaseOnto(name)"
  >
    <NuxtIcon name="lucide:git-graph" />
    {{ t('branch.rebaseOnto') }}
  </UiDropdownMenuItem>
  <UiDropdownMenuSeparator />
  <UiDropdownMenuItem
    class="text-destructive focus:text-destructive"
    :disabled="name === repo.currentBranch"
    @click="repo.deleteBranch(name)"
  >
    <NuxtIcon name="lucide:trash-2" />
    {{ t('branch.delete') }}
  </UiDropdownMenuItem>
</template>
