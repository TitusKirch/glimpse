<script setup lang="ts">
// One remote-branch row. Collapsed (icon-only) sidebar: the whole button opens
// a dropdown with the actions; expanded: click checks it out as a local
// tracking branch, the hover "…" opens the same actions. Mirrors
// SidebarBranchItem so remote branches behave like local ones when collapsed
// (instead of firing the checkout confirm directly).
const props = defineProps<{ rb: string; collapsed: boolean }>();
const repo = useRepoStore();
const { shortenBranch } = useBranchLabel();

// "origin/dev" -> "dev": the local tracking-branch name a checkout would create.
function shortName(remoteBranch: string): string {
  const i = remoteBranch.indexOf('/');
  return i >= 0 ? remoteBranch.slice(i + 1) : remoteBranch;
}

// A plain branch icon once a matching local branch exists, else the "+" variant
// to signal that checking it out creates a new tracking branch.
const icon = computed(() =>
  repo.branches.some((b) => b.name === shortName(props.rb))
    ? 'lucide:git-branch'
    : 'lucide:git-branch-plus'
);
</script>

<template>
  <!-- collapsed: the button is the dropdown trigger -->
  <UiSidebarMenuItem v-if="collapsed">
    <UiDropdownMenu>
      <UiDropdownMenuTrigger as-child>
        <UiSidebarMenuButton
          :is-active="shortName(rb) === repo.currentBranch"
          :tooltip="rb"
        >
          <NuxtIcon :name="icon" class="shrink-0" />
          <span>{{ shortenBranch(rb) }}</span>
        </UiSidebarMenuButton>
      </UiDropdownMenuTrigger>
      <UiDropdownMenuContent side="right" align="start" class="w-48">
        <SidebarRemoteBranchActions :rb="rb" />
      </UiDropdownMenuContent>
    </UiDropdownMenu>
  </UiSidebarMenuItem>

  <!-- expanded: click checks out; "…" opens the actions -->
  <UiSidebarMenuItem v-else>
    <UiSidebarMenuButton
      :is-active="shortName(rb) === repo.currentBranch"
      @click="repo.checkoutRemote(rb)"
    >
      <NuxtIcon :name="icon" class="shrink-0" />
      <UiTooltip>
        <UiTooltipTrigger as-child>
          <span class="truncate">{{ shortenBranch(rb) }}</span>
        </UiTooltipTrigger>
        <UiTooltipContent side="right">{{ rb }}</UiTooltipContent>
      </UiTooltip>
    </UiSidebarMenuButton>
    <UiDropdownMenu>
      <UiDropdownMenuTrigger as-child>
        <UiSidebarMenuAction show-on-hover class="cursor-pointer">
          <NuxtIcon name="lucide:ellipsis" />
        </UiSidebarMenuAction>
      </UiDropdownMenuTrigger>
      <UiDropdownMenuContent side="right" align="start">
        <SidebarRemoteBranchActions :rb="rb" />
      </UiDropdownMenuContent>
    </UiDropdownMenu>
  </UiSidebarMenuItem>
</template>
