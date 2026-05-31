<script setup lang="ts">
// One branch row. Collapsed (icon-only) sidebar: the whole button opens a
// dropdown with the branch actions; expanded: click switches, the hover "…"
// action opens the same actions. Tooltip shows the branch name either way.
import type { Branch } from '@/stores/repo';

defineProps<{ branch: Branch; collapsed: boolean }>();
const repo = useRepoStore();
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
        v-if="branch.ahead || branch.behind"
        class="ml-auto flex shrink-0 items-center gap-1 pl-1 text-[10px] font-medium"
      >
        <span
          v-if="branch.ahead"
          class="flex h-4 items-center gap-0.5 rounded bg-green-500/15 px-1 text-green-600 dark:text-green-400"
          ><NuxtIcon name="lucide:arrow-up" class="size-3" />{{
            branch.ahead
          }}</span
        >
        <span
          v-if="branch.behind"
          class="flex h-4 items-center gap-0.5 rounded bg-amber-500/15 px-1 text-amber-600 dark:text-amber-400"
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
