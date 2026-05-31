<script setup lang="ts">
// One branch row. Collapsed (icon-only) sidebar: the whole button opens a
// dropdown with the branch actions; expanded: click switches, the hover "…"
// action opens the same actions. Tooltip shows the branch name either way.
import type { Branch } from '@/stores/repo';

defineProps<{ branch: Branch; collapsed: boolean }>();
const repo = useRepoStore();
const { t } = useI18n();
</script>

<template>
  <!-- collapsed: the button is the dropdown trigger -->
  <UiSidebarMenuItem v-if="collapsed">
    <UiDropdownMenu>
      <UiDropdownMenuTrigger as-child>
        <UiSidebarMenuButton
          :is-active="branch.name === repo.currentBranch"
          :tooltip="branch.name"
        >
          <NuxtIcon name="lucide:git-branch" class="shrink-0" />
          <span>{{ branch.name }}</span>
        </UiSidebarMenuButton>
      </UiDropdownMenuTrigger>
      <UiDropdownMenuContent side="right" align="start" class="w-48">
        <BranchActions :name="branch.name" />
      </UiDropdownMenuContent>
    </UiDropdownMenu>
  </UiSidebarMenuItem>

  <!-- expanded: click switches; "…" opens the actions -->
  <UiSidebarMenuItem v-else>
    <UiSidebarMenuButton
      :is-active="branch.name === repo.currentBranch"
      :tooltip="branch.name"
      @click="repo.checkout(branch.name)"
    >
      <NuxtIcon name="lucide:git-branch" class="shrink-0" />
      <span class="truncate">{{ branch.name }}</span>
      <span
        v-if="!branch.published"
        :title="t('sidebar.localOnlyHint')"
        class="ml-auto flex shrink-0 items-center gap-0.5 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] leading-none font-medium text-destructive"
        ><NuxtIcon name="lucide:cloud-off" class="size-3" />{{
          t('sidebar.localOnly')
        }}</span
      >
      <span
        v-else-if="branch.ahead || branch.behind"
        class="ml-auto flex shrink-0 items-center gap-2 pl-1 text-[11px] font-medium tabular-nums"
      >
        <span
          v-if="branch.ahead"
          class="flex items-center gap-0.5 text-green-600 dark:text-green-400"
          ><NuxtIcon name="lucide:arrow-up" class="size-3" />{{
            branch.ahead
          }}</span
        >
        <span
          v-if="branch.behind"
          class="flex items-center gap-0.5 text-amber-600 dark:text-amber-400"
          ><NuxtIcon name="lucide:arrow-down" class="size-3" />{{
            branch.behind
          }}</span
        >
      </span>
    </UiSidebarMenuButton>
    <UiDropdownMenu>
      <UiDropdownMenuTrigger as-child>
        <UiSidebarMenuAction show-on-hover class="cursor-pointer">
          <NuxtIcon name="lucide:ellipsis" />
        </UiSidebarMenuAction>
      </UiDropdownMenuTrigger>
      <UiDropdownMenuContent side="right" align="start" class="w-48">
        <BranchActions :name="branch.name" />
      </UiDropdownMenuContent>
    </UiDropdownMenu>
  </UiSidebarMenuItem>
</template>
