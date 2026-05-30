<script setup lang="ts">
import { Cloud, GitBranch, Plus, Tag, X } from '@lucide/vue';

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
          <Plus />
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
              <X class="size-4" />
            </UiButton>
          </div>
          <UiSidebarMenu>
            <UiSidebarMenuItem v-for="b in repo.branches" :key="b">
              <UiSidebarMenuButton
                :is-active="b === repo.currentBranch"
                :tooltip="b"
                @click="repo.checkout(b)"
              >
                <GitBranch />
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
                <Cloud />
                <span>{{ r }}</span>
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
                <Tag />
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
