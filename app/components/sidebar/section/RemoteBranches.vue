<script setup lang="ts">
import { useSidebar } from '@/components/ui/sidebar';

const repo = useRepoStore();
const { t } = useI18n();

const { state, isMobile } = useSidebar();
const isCollapsed = computed(
  () => state.value === 'collapsed' && !isMobile.value
);

const remoteBranchesMore = useSidebarMore({
  items: () => repo.remoteBranches
});
</script>

<template>
  <SidebarSection
    section-id="remoteBranches"
    :label="t('sidebar.remoteBranches')"
  >
    <SidebarSectionSkeleton
      v-if="repo.loading && !repo.remoteBranches.length"
    />
    <UiSidebarMenu v-else>
      <SidebarRemoteBranchItem
        v-for="rb in remoteBranchesMore.visible.value"
        :key="rb"
        :rb="rb"
        :collapsed="isCollapsed"
      />
      <SidebarMoreButton
        :hidden-count="remoteBranchesMore.hiddenCount.value"
        :expanded="remoteBranchesMore.isExpanded.value"
        :can-collapse="remoteBranchesMore.canCollapse.value"
        @toggle="remoteBranchesMore.toggle()"
      />
    </UiSidebarMenu>
  </SidebarSection>
</template>
