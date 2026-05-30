<script setup lang="ts">
const repo = useRepoStore();
const { t } = useI18n();

const creating = ref(false);
const newBranch = ref('');

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
        <UiSidebarGroupAction
          :title="t('sidebar.newBranch')"
          @click="creating = !creating"
        >
          <NuxtIcon name="lucide:git-branch-plus" />
        </UiSidebarGroupAction>
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
            <UiSidebarMenuItem v-for="b in repo.branches" :key="b">
              <UiSidebarMenuButton
                :is-active="b === repo.currentBranch"
                :tooltip="b"
                @click="repo.checkout(b)"
              >
                <NuxtIcon name="lucide:git-branch" />
                <span>{{ b }}</span>
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
                <NuxtIcon name="lucide:cloud" />
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
                    repo.branches.includes(shortName(rb))
                      ? 'lucide:git-branch'
                      : 'lucide:git-branch-plus'
                  "
                  class="opacity-60"
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
                <NuxtIcon name="lucide:tag" />
                <span>{{ tag }}</span>
              </UiSidebarMenuButton>
            </UiSidebarMenuItem>
          </UiSidebarMenu>
        </UiSidebarGroupContent>
      </UiSidebarGroup>
    </UiSidebarContent>

    <UiSidebarRail />
  </UiSidebar>
</template>
