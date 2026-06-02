<script setup lang="ts">
import { useSidebar } from '@/components/ui/sidebar';

const repo = useRepoStore();
const settings = useSettingsDialog();
const remoteDialog = useRemoteDialog();
const openRepoDialog = useOpenRepoDialog();
const help = useHelpDialog();
const { t } = useI18n();

// Build-identity tag next to the app name: the experiment name on an experiment
// build, else BETA on a pre-release. Hidden on stable/dev. Reflects the *running
// build*, not the updater channel setting.
const { isBeta, isExperiment, experiment } = useAppVersion();

// Collapsed (icon-only) sidebar: items open a dropdown instead of acting
// directly, so their actions stay reachable.
const { state, isMobile } = useSidebar();
const isCollapsed = computed(
  () => state.value === 'collapsed' && !isMobile.value
);

const layout = useLayoutStore();
const { shortenBranch } = useBranchLabel();
// Drag-to-resize the expanded sidebar within [12rem, 32rem] (default 16rem).
// Width persists in the layout store and feeds --sidebar-width via the
// provider. Transitions are suppressed (body class) during the drag so it
// tracks the pointer crisply.
const MIN_WIDTH = 192;
const MAX_WIDTH = 512;
const canResize = computed(
  () => layout.sidebarResizable && state.value === 'expanded' && !isMobile.value
);
function startResize(e: PointerEvent) {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = layout.sidebarWidth;
  document.body.classList.add('resizing-sidebar');
  const onMove = (ev: PointerEvent) => {
    const next = startWidth + (ev.clientX - startX);
    layout.sidebarWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next));
  };
  const onUp = () => {
    document.body.classList.remove('resizing-sidebar');
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// Capped lists with gildstone-style "show N more / show less".
const branchesMore = useSidebarMore(() => repo.branches);
const remoteBranchesMore = useSidebarMore(() => repo.remoteBranches);
const tagsMore = useSidebarMore(() => repo.tags);

// "origin/dev" -> "dev"; checking it out lets git create a tracking branch.
function shortName(remoteBranch: string): string {
  const i = remoteBranch.indexOf('/');
  return i >= 0 ? remoteBranch.slice(i + 1) : remoteBranch;
}

// External links pinned to the bottom of the sidebar.
const links = [
  {
    title: 'GitHub',
    url: 'https://github.com/TitusKirch/glimpse',
    icon: 'simple-icons:github'
  },
  {
    title: 'Discord',
    url: 'https://discord.gg/cwFp2nx',
    icon: 'simple-icons:discord'
  },
  {
    title: 'Report a bug',
    url: 'https://github.com/TitusKirch/glimpse/issues',
    icon: 'lucide:bug'
  }
];
</script>

<template>
  <UiSidebar collapsible="icon">
    <UiSidebarHeader>
      <div
        class="flex h-8 items-center gap-2 overflow-hidden text-sm font-bold"
      >
        <img src="/logo_128x128.png" alt="" class="size-8 shrink-0" />
        <span class="truncate">{{ t('app.name') }}</span>
        <UiBadge
          v-if="isExperiment"
          variant="destructive"
          icon="lucide:flask-conical"
          class="max-w-40 group-data-[collapsible=icon]:hidden"
        >
          <span class="min-w-0 truncate">{{ experiment }}</span>
        </UiBadge>
        <UiBadge
          v-else-if="isBeta"
          variant="warning"
          icon="lucide:rocket"
          class="group-data-[collapsible=icon]:hidden"
        >
          BETA
        </UiBadge>
      </div>
    </UiSidebarHeader>

    <UiSidebarContent>
      <!-- no repo open: prompt to open one instead of empty branch lists -->
      <div
        v-if="!repo.hasRepos"
        class="p-2 group-data-[collapsible=icon]:hidden"
      >
        <UiAlert>
          <NuxtIcon name="lucide:folder-open" mode="svg" class="size-4" />
          <UiAlertTitle>{{ t('sidebar.noRepo.title') }}</UiAlertTitle>
          <UiAlertDescription>{{
            t('sidebar.noRepo.hint')
          }}</UiAlertDescription>
        </UiAlert>
        <UiButton
          size="sm"
          class="mt-2 w-full"
          icon="lucide:folder-open"
          @click="openRepoDialog.show()"
        >
          {{ t('actions.openRepo') }}
        </UiButton>
      </div>

      <UiSidebarGroup v-if="repo.hasRepos">
        <UiSidebarGroupLabel>{{ t('sidebar.branches') }}</UiSidebarGroupLabel>
        <UiTooltip>
          <UiTooltipTrigger as-child>
            <UiSidebarGroupAction
              class="size-6 cursor-pointer"
              @click="repo.createBranchPrompt()"
            >
              <NuxtIcon name="lucide:git-branch-plus" class="shrink-0" />
            </UiSidebarGroupAction>
          </UiTooltipTrigger>
          <UiTooltipContent>{{ t('sidebar.newBranch') }}</UiTooltipContent>
        </UiTooltip>
        <UiSidebarGroupContent>
          <UiSidebarMenu>
            <SidebarBranchItem
              v-for="b in branchesMore.visible.value"
              :key="b.name"
              :branch="b"
              :collapsed="isCollapsed"
            />
            <SidebarMoreButton
              :hidden-count="branchesMore.hiddenCount.value"
              :expanded="branchesMore.isExpanded.value"
              :can-collapse="branchesMore.canCollapse.value"
              @toggle="branchesMore.toggle()"
            />
          </UiSidebarMenu>
        </UiSidebarGroupContent>
      </UiSidebarGroup>

      <UiSidebarGroup v-if="repo.hasRepos">
        <UiSidebarGroupLabel>{{ t('sidebar.remotes') }}</UiSidebarGroupLabel>
        <UiTooltip>
          <UiTooltipTrigger as-child>
            <UiSidebarGroupAction
              class="size-6 cursor-pointer"
              @click="remoteDialog.show()"
            >
              <NuxtIcon name="lucide:plus" class="shrink-0" />
            </UiSidebarGroupAction>
          </UiTooltipTrigger>
          <UiTooltipContent>{{ t('sidebar.addRemote') }}</UiTooltipContent>
        </UiTooltip>
        <UiSidebarGroupContent>
          <UiSidebarMenu>
            <UiSidebarMenuItem v-for="r in repo.remotes" :key="r">
              <UiSidebarMenuButton :tooltip="r">
                <NuxtIcon name="lucide:cloud" class="shrink-0" />
                <span>{{ r }}</span>
              </UiSidebarMenuButton>
              <UiDropdownMenu>
                <UiDropdownMenuTrigger as-child>
                  <UiSidebarMenuAction show-on-hover class="cursor-pointer">
                    <NuxtIcon name="lucide:ellipsis" />
                  </UiSidebarMenuAction>
                </UiDropdownMenuTrigger>
                <UiDropdownMenuContent side="right" align="start">
                  <UiDropdownMenuItem @click="repo.renameRemote(r)">
                    <NuxtIcon name="lucide:pencil" />
                    {{ t('branch.rename') }}
                  </UiDropdownMenuItem>
                  <UiDropdownMenuSeparator />
                  <UiDropdownMenuItem
                    class="text-destructive focus:text-destructive"
                    @click="repo.removeRemote(r)"
                  >
                    <NuxtIcon name="lucide:trash-2" />
                    {{ t('branch.delete') }}
                  </UiDropdownMenuItem>
                </UiDropdownMenuContent>
              </UiDropdownMenu>
            </UiSidebarMenuItem>
          </UiSidebarMenu>
        </UiSidebarGroupContent>
      </UiSidebarGroup>

      <UiSidebarGroup v-if="repo.remoteBranches.length">
        <UiSidebarGroupLabel>{{
          t('sidebar.remoteBranches')
        }}</UiSidebarGroupLabel>
        <UiSidebarGroupContent>
          <UiSidebarMenu>
            <UiSidebarMenuItem
              v-for="rb in remoteBranchesMore.visible.value"
              :key="rb"
            >
              <UiSidebarMenuButton
                :is-active="shortName(rb) === repo.currentBranch"
                :tooltip="rb"
                @click="repo.checkoutRemote(rb)"
              >
                <NuxtIcon
                  :name="
                    repo.branches.some((b) => b.name === shortName(rb))
                      ? 'lucide:git-branch'
                      : 'lucide:git-branch-plus'
                  "
                  class="shrink-0"
                />
                <UiTooltip>
                  <UiTooltipTrigger as-child>
                    <span class="truncate">{{ shortenBranch(rb) }}</span>
                  </UiTooltipTrigger>
                  <UiTooltipContent side="right">{{ rb }}</UiTooltipContent>
                </UiTooltip>
              </UiSidebarMenuButton>
            </UiSidebarMenuItem>
            <SidebarMoreButton
              :hidden-count="remoteBranchesMore.hiddenCount.value"
              :expanded="remoteBranchesMore.isExpanded.value"
              :can-collapse="remoteBranchesMore.canCollapse.value"
              @toggle="remoteBranchesMore.toggle()"
            />
          </UiSidebarMenu>
        </UiSidebarGroupContent>
      </UiSidebarGroup>

      <UiSidebarGroup v-if="repo.hasRepos">
        <UiSidebarGroupLabel>{{ t('sidebar.tags') }}</UiSidebarGroupLabel>
        <UiTooltip>
          <UiTooltipTrigger as-child>
            <UiSidebarGroupAction
              class="size-6 cursor-pointer"
              @click="repo.createTagPrompt()"
            >
              <NuxtIcon name="lucide:tag" class="shrink-0" />
            </UiSidebarGroupAction>
          </UiTooltipTrigger>
          <UiTooltipContent>{{ t('sidebar.newTag') }}</UiTooltipContent>
        </UiTooltip>
        <UiSidebarGroupContent>
          <UiSidebarMenu>
            <UiSidebarMenuItem v-for="tag in tagsMore.visible.value" :key="tag">
              <UiSidebarMenuButton :tooltip="tag">
                <NuxtIcon name="lucide:tag" class="shrink-0" />
                <span>{{ tag }}</span>
              </UiSidebarMenuButton>
              <UiDropdownMenu>
                <UiDropdownMenuTrigger as-child>
                  <UiSidebarMenuAction show-on-hover class="cursor-pointer">
                    <NuxtIcon name="lucide:ellipsis" />
                  </UiSidebarMenuAction>
                </UiDropdownMenuTrigger>
                <UiDropdownMenuContent side="right" align="start">
                  <UiDropdownMenuItem
                    class="text-destructive focus:text-destructive"
                    @click="repo.deleteTag(tag)"
                  >
                    <NuxtIcon name="lucide:trash-2" />
                    {{ t('branch.delete') }}
                  </UiDropdownMenuItem>
                </UiDropdownMenuContent>
              </UiDropdownMenu>
            </UiSidebarMenuItem>
            <SidebarMoreButton
              :hidden-count="tagsMore.hiddenCount.value"
              :expanded="tagsMore.isExpanded.value"
              :can-collapse="tagsMore.canCollapse.value"
              @toggle="tagsMore.toggle()"
            />
          </UiSidebarMenu>
        </UiSidebarGroupContent>
      </UiSidebarGroup>

      <UiSidebarGroup v-if="repo.hasRepos">
        <UiSidebarGroupLabel>{{ t('sidebar.stashes') }}</UiSidebarGroupLabel>
        <UiTooltip>
          <UiTooltipTrigger as-child>
            <UiSidebarGroupAction
              class="size-6 cursor-pointer"
              @click="repo.stashSave()"
            >
              <NuxtIcon name="lucide:archive" class="shrink-0" />
            </UiSidebarGroupAction>
          </UiTooltipTrigger>
          <UiTooltipContent>{{ t('sidebar.stashPush') }}</UiTooltipContent>
        </UiTooltip>
        <UiSidebarGroupContent>
          <p
            v-if="!repo.stashes.length"
            class="px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden"
          >
            {{ t('sidebar.noStashes') }}
          </p>
          <UiSidebarMenu>
            <UiSidebarMenuItem v-for="s in repo.stashes" :key="s.reference">
              <UiSidebarMenuButton
                :tooltip="s.message"
                :is-active="repo.selectedHash === s.reference"
                @click="repo.selectCommit(s.reference)"
              >
                <NuxtIcon name="lucide:archive" class="shrink-0" />
                <span class="truncate">{{ s.message }}</span>
              </UiSidebarMenuButton>
              <UiDropdownMenu>
                <UiDropdownMenuTrigger as-child>
                  <UiSidebarMenuAction show-on-hover class="cursor-pointer">
                    <NuxtIcon name="lucide:ellipsis" />
                  </UiSidebarMenuAction>
                </UiDropdownMenuTrigger>
                <UiDropdownMenuContent side="right" align="start">
                  <UiDropdownMenuItem
                    @click="
                      repo.stashAction({
                        action: 'pop',
                        reference: s.reference
                      })
                    "
                  >
                    <NuxtIcon name="lucide:archive-restore" />
                    {{ t('sidebar.stashPop') }}
                  </UiDropdownMenuItem>
                  <UiDropdownMenuItem
                    @click="
                      repo.stashAction({
                        action: 'apply',
                        reference: s.reference
                      })
                    "
                  >
                    <NuxtIcon name="lucide:copy-plus" />
                    {{ t('sidebar.stashApply') }}
                  </UiDropdownMenuItem>
                  <UiDropdownMenuSeparator />
                  <UiDropdownMenuItem
                    class="text-destructive focus:text-destructive"
                    @click="
                      repo.stashAction({
                        action: 'drop',
                        reference: s.reference
                      })
                    "
                  >
                    <NuxtIcon name="lucide:trash-2" />
                    {{ t('sidebar.stashDrop') }}
                  </UiDropdownMenuItem>
                </UiDropdownMenuContent>
              </UiDropdownMenu>
            </UiSidebarMenuItem>
          </UiSidebarMenu>
        </UiSidebarGroupContent>
      </UiSidebarGroup>
    </UiSidebarContent>

    <!-- static footer: stays put while the content above scrolls -->
    <UiSidebarFooter>
      <UiSidebarMenu>
        <UiSidebarMenuItem v-for="item in links" :key="item.title">
          <UiSidebarMenuButton as-child :tooltip="item.title">
            <a
              :href="item.url"
              target="_blank"
              rel="noopener noreferrer"
              @click.prevent="openExternal(item.url)"
            >
              <NuxtIcon :name="item.icon" class="shrink-0" />
              <span>{{ item.title }}</span>
            </a>
          </UiSidebarMenuButton>
        </UiSidebarMenuItem>
        <UiSidebarMenuItem>
          <UiSidebarMenuButton :tooltip="t('help.title')" @click="help.show()">
            <NuxtIcon name="lucide:keyboard" class="shrink-0" />
            <span>{{ t('help.title') }}</span>
          </UiSidebarMenuButton>
        </UiSidebarMenuItem>
        <UiSidebarMenuItem>
          <UiSidebarMenuButton
            :tooltip="t('settings.title')"
            @click="settings.show()"
          >
            <NuxtIcon name="lucide:settings" class="shrink-0" />
            <span>{{ t('settings.title') }}</span>
          </UiSidebarMenuButton>
        </UiSidebarMenuItem>
      </UiSidebarMenu>
    </UiSidebarFooter>

    <UiSidebarRail />

    <!-- Drag handle on the right edge to resize the expanded sidebar. -->
    <div
      v-if="canResize"
      class="absolute inset-y-0 right-0 z-30 w-1 cursor-col-resize transition-colors hover:bg-sidebar-border"
      @pointerdown="startResize"
    />
  </UiSidebar>
</template>
