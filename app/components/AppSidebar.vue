<script setup lang="ts">
const repo = useRepoStore();
const { t } = useI18n();

const creating = ref(false);
const newBranch = ref('');
const settingsOpen = ref(false);

function cancel() {
  creating.value = false;
  newBranch.value = '';
}

async function submitBranch() {
  if (!newBranch.value.trim()) return;
  await repo.createBranch(newBranch.value);
  cancel();
}

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
      <div class="flex h-8 items-center gap-2 px-2 text-sm font-bold">
        <span>👀</span>
        <span class="group-data-[collapsible=icon]:hidden">{{
          t('app.name')
        }}</span>
      </div>
    </UiSidebarHeader>

    <UiSidebarContent>
      <UiSidebarGroup>
        <UiSidebarGroupLabel>{{ t('sidebar.branches') }}</UiSidebarGroupLabel>
        <UiTooltip>
          <UiTooltipTrigger as-child>
            <UiSidebarGroupAction
              class="size-6 cursor-pointer"
              @click="creating = !creating"
            >
              <NuxtIcon name="lucide:git-branch-plus" class="shrink-0" />
            </UiSidebarGroupAction>
          </UiTooltipTrigger>
          <UiTooltipContent>{{ t('sidebar.newBranch') }}</UiTooltipContent>
        </UiTooltip>
        <UiSidebarGroupContent>
          <div
            v-if="creating"
            class="flex items-center gap-1 px-2 pb-1 group-data-[collapsible=icon]:hidden"
          >
            <UiSidebarInput
              v-model="newBranch"
              :placeholder="t('sidebar.branchName')"
              autofocus
              @keydown.enter="submitBranch"
              @keydown.esc="cancel"
            />
            <UiButton
              variant="ghost"
              size="icon"
              class="size-7 shrink-0"
              @click="cancel"
            >
              <NuxtIcon name="lucide:x" class="size-4" />
            </UiButton>
          </div>
          <UiSidebarMenu>
            <UiSidebarMenuItem v-for="b in repo.branches" :key="b.name">
              <UiSidebarMenuButton
                :is-active="b.name === repo.currentBranch"
                :tooltip="b.name"
                @click="repo.checkout(b.name)"
              >
                <NuxtIcon name="lucide:git-branch" class="shrink-0" />
                <span>{{ b.name }}</span>
                <span
                  v-if="b.ahead || b.behind"
                  class="ml-auto flex items-center gap-1 text-[11px] font-medium"
                >
                  <span
                    v-if="b.ahead"
                    class="flex items-center gap-0.5 rounded-md bg-green-500/15 px-1.5 py-0.5 text-green-600 dark:text-green-400"
                    ><NuxtIcon name="lucide:arrow-up" class="size-3.5" />{{
                      b.ahead
                    }}</span
                  >
                  <span
                    v-if="b.behind"
                    class="flex items-center gap-0.5 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-amber-600 dark:text-amber-400"
                    ><NuxtIcon name="lucide:arrow-down" class="size-3.5" />{{
                      b.behind
                    }}</span
                  >
                </span>
              </UiSidebarMenuButton>
            </UiSidebarMenuItem>
          </UiSidebarMenu>
        </UiSidebarGroupContent>
      </UiSidebarGroup>

      <UiSidebarGroup>
        <UiSidebarGroupLabel>{{ t('sidebar.remotes') }}</UiSidebarGroupLabel>
        <UiSidebarGroupContent>
          <UiSidebarMenu>
            <UiSidebarMenuItem v-for="r in repo.remotes" :key="r">
              <UiSidebarMenuButton :tooltip="r">
                <NuxtIcon name="lucide:cloud" class="shrink-0" />
                <span>{{ r }}</span>
              </UiSidebarMenuButton>
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
            <UiSidebarMenuItem v-for="rb in repo.remoteBranches" :key="rb">
              <UiSidebarMenuButton
                :is-active="shortName(rb) === repo.currentBranch"
                :tooltip="rb"
                @click="repo.checkout(shortName(rb))"
              >
                <NuxtIcon
                  :name="
                    repo.branches.some((b) => b.name === shortName(rb))
                      ? 'lucide:git-branch'
                      : 'lucide:git-branch-plus'
                  "
                  class="shrink-0"
                />
                <span>{{ rb }}</span>
              </UiSidebarMenuButton>
            </UiSidebarMenuItem>
          </UiSidebarMenu>
        </UiSidebarGroupContent>
      </UiSidebarGroup>

      <UiSidebarGroup v-if="repo.tags.length">
        <UiSidebarGroupLabel>{{ t('sidebar.tags') }}</UiSidebarGroupLabel>
        <UiSidebarGroupContent>
          <UiSidebarMenu>
            <UiSidebarMenuItem v-for="tag in repo.tags" :key="tag">
              <UiSidebarMenuButton :tooltip="tag">
                <NuxtIcon name="lucide:tag" class="shrink-0" />
                <span>{{ tag }}</span>
              </UiSidebarMenuButton>
            </UiSidebarMenuItem>
          </UiSidebarMenu>
        </UiSidebarGroupContent>
      </UiSidebarGroup>

      <UiSidebarGroup class="mt-auto">
        <UiSidebarGroupContent>
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
              <UiSidebarMenuButton
                :tooltip="t('settings.title')"
                @click="settingsOpen = true"
              >
                <NuxtIcon name="lucide:settings" class="shrink-0" />
                <span>{{ t('settings.title') }}</span>
              </UiSidebarMenuButton>
            </UiSidebarMenuItem>
          </UiSidebarMenu>
        </UiSidebarGroupContent>
      </UiSidebarGroup>
    </UiSidebarContent>

    <UiSidebarRail />
  </UiSidebar>

  <SettingsDialog v-model:open="settingsOpen" />
</template>
