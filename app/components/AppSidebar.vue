<script setup lang="ts">
const repo = useRepoStore();
const settings = useSettingsDialog();
const { t } = useI18n();

const creating = ref(false);
const newBranch = ref('');

// Inline rename: which branch is being renamed, and its draft name.
const renaming = ref<string | null>(null);
const renameDraft = ref('');

function cancel() {
  creating.value = false;
  newBranch.value = '';
}

async function submitBranch() {
  if (!newBranch.value.trim()) return;
  await repo.createBranch(newBranch.value);
  cancel();
}

// Inline tag creation (tags HEAD).
const creatingTag = ref(false);
const newTag = ref('');
function cancelTag() {
  creatingTag.value = false;
  newTag.value = '';
}
async function submitTag() {
  if (!newTag.value.trim()) return;
  await repo.createTag(newTag.value);
  cancelTag();
}

function startRename(name: string) {
  renaming.value = name;
  renameDraft.value = name;
}
function cancelRename() {
  renaming.value = null;
  renameDraft.value = '';
}
async function submitRename(oldName: string) {
  await repo.renameBranch(oldName, renameDraft.value);
  cancelRename();
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
            <template v-for="b in repo.branches" :key="b.name">
              <UiSidebarMenuItem v-if="renaming === b.name">
                <div
                  class="flex items-center gap-1 px-2 py-1 group-data-[collapsible=icon]:hidden"
                >
                  <UiSidebarInput
                    v-model="renameDraft"
                    autofocus
                    @keydown.enter="submitRename(b.name)"
                    @keydown.esc="cancelRename"
                  />
                  <UiButton
                    variant="ghost"
                    size="icon"
                    class="size-7 shrink-0"
                    @click="cancelRename"
                  >
                    <NuxtIcon name="lucide:x" class="size-4" />
                  </UiButton>
                </div>
              </UiSidebarMenuItem>
              <UiSidebarMenuItem v-else>
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
                <UiDropdownMenu>
                  <UiDropdownMenuTrigger as-child>
                    <UiSidebarMenuAction show-on-hover class="cursor-pointer">
                      <NuxtIcon name="lucide:ellipsis" />
                    </UiSidebarMenuAction>
                  </UiDropdownMenuTrigger>
                  <UiDropdownMenuContent side="right" align="start">
                    <UiDropdownMenuItem
                      :disabled="b.name === repo.currentBranch"
                      @click="repo.checkout(b.name)"
                    >
                      <NuxtIcon name="lucide:check" />
                      {{ t('branch.switch') }}
                    </UiDropdownMenuItem>
                    <UiDropdownMenuItem @click="startRename(b.name)">
                      <NuxtIcon name="lucide:pencil" />
                      {{ t('branch.rename') }}
                    </UiDropdownMenuItem>
                    <UiDropdownMenuSeparator />
                    <UiDropdownMenuItem
                      class="text-destructive focus:text-destructive"
                      :disabled="b.name === repo.currentBranch"
                      @click="repo.deleteBranch(b.name)"
                    >
                      <NuxtIcon name="lucide:trash-2" />
                      {{ t('branch.delete') }}
                    </UiDropdownMenuItem>
                  </UiDropdownMenuContent>
                </UiDropdownMenu>
              </UiSidebarMenuItem>
            </template>
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

      <UiSidebarGroup v-if="repo.hasRepos">
        <UiSidebarGroupLabel>{{ t('sidebar.tags') }}</UiSidebarGroupLabel>
        <UiTooltip>
          <UiTooltipTrigger as-child>
            <UiSidebarGroupAction
              class="size-6 cursor-pointer"
              @click="creatingTag = !creatingTag"
            >
              <NuxtIcon name="lucide:tag" class="shrink-0" />
            </UiSidebarGroupAction>
          </UiTooltipTrigger>
          <UiTooltipContent>{{ t('sidebar.newTag') }}</UiTooltipContent>
        </UiTooltip>
        <UiSidebarGroupContent>
          <div
            v-if="creatingTag"
            class="flex items-center gap-1 px-2 pb-1 group-data-[collapsible=icon]:hidden"
          >
            <UiSidebarInput
              v-model="newTag"
              :placeholder="t('sidebar.tagName')"
              autofocus
              @keydown.enter="submitTag"
              @keydown.esc="cancelTag"
            />
            <UiButton
              variant="ghost"
              size="icon"
              class="size-7 shrink-0"
              @click="cancelTag"
            >
              <NuxtIcon name="lucide:x" class="size-4" />
            </UiButton>
          </div>
          <UiSidebarMenu>
            <UiSidebarMenuItem v-for="tag in repo.tags" :key="tag">
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
              <UiSidebarMenuButton :tooltip="s.message">
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
                    @click="repo.stashAction('pop', s.reference)"
                  >
                    <NuxtIcon name="lucide:archive-restore" />
                    {{ t('sidebar.stashPop') }}
                  </UiDropdownMenuItem>
                  <UiDropdownMenuItem
                    @click="repo.stashAction('apply', s.reference)"
                  >
                    <NuxtIcon name="lucide:copy-plus" />
                    {{ t('sidebar.stashApply') }}
                  </UiDropdownMenuItem>
                  <UiDropdownMenuSeparator />
                  <UiDropdownMenuItem
                    class="text-destructive focus:text-destructive"
                    @click="repo.stashAction('drop', s.reference)"
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
                @click="settings.show()"
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
</template>
