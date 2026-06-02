<script setup lang="ts">
// Shared tag dropdown items (delete), used by both the expanded action menu and
// the collapsed-sidebar dropdown.
defineProps<{ tag: string }>();
const repo = useRepoStore();
const { t } = useI18n();
</script>

<template>
  <UiDropdownMenuItem
    class="text-destructive focus:text-destructive"
    @click="repo.deleteTag(tag)"
  >
    <NuxtIcon name="lucide:trash-2" />
    {{ t('branch.delete') }}
  </UiDropdownMenuItem>
</template>
