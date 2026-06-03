<script setup lang="ts">
import { useSidebar } from '@/components/ui/sidebar';

const repo = useRepoStore();
const { t } = useI18n();

const { state, isMobile } = useSidebar();
const isCollapsed = computed(
  () => state.value === 'collapsed' && !isMobile.value
);

const branchesMore = useSidebarMore({ items: () => repo.branches });
</script>

<template>
  <SidebarSection section-id="branches" :label="t('sidebar.branches')">
    <template #action>
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
    </template>
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
  </SidebarSection>
</template>
