<script setup lang="ts">
// Shared remote-branch dropdown items (checkout as a tracking branch / merge),
// used by both the expanded action menu and the collapsed-sidebar dropdown.
defineProps<{ rb: string }>();
const repo = useRepoStore();
const { t } = useI18n();
</script>

<template>
  <UiDropdownMenuItem @click="repo.checkoutRemote(rb)">
    <NuxtIcon name="lucide:git-branch-plus" />
    {{ t('branch.checkoutRemote') }}
  </UiDropdownMenuItem>
  <UiDropdownMenuItem @click="repo.merge(rb)">
    <NuxtIcon name="lucide:git-merge" />
    {{ t('branch.merge') }}
  </UiDropdownMenuItem>
</template>
