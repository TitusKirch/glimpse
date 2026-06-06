<script setup lang="ts">
import { useSidebar } from '@/components/ui/sidebar';

const repo = useRepoStore();
const { t } = useI18n();

const { state, isMobile } = useSidebar();
const isCollapsed = computed(
  () => state.value === 'collapsed' && !isMobile.value
);

const tagsMore = useSidebarMore({ items: () => repo.tags });

// Dismiss the action's tooltip as the prompt opens (it otherwise sticks over it).
const { open: actionTip, onActivate } = useDismissableTooltip();
</script>

<template>
  <SidebarSection section-id="tags" :label="t('sidebar.tags')">
    <template #action>
      <UiTooltip v-model:open="actionTip">
        <UiTooltipTrigger as-child>
          <UiSidebarGroupAction
            class="size-6 cursor-pointer"
            :aria-label="t('sidebar.newTag')"
            @click="onActivate(() => repo.createTagPrompt())"
          >
            <NuxtIcon name="lucide:tag" class="shrink-0" />
          </UiSidebarGroupAction>
        </UiTooltipTrigger>
        <UiTooltipContent>{{ t('sidebar.newTag') }}</UiTooltipContent>
      </UiTooltip>
    </template>
    <SidebarSectionSkeleton v-if="repo.loading && !repo.tags.length" />
    <UiSidebarMenu v-else>
      <SidebarTagItem
        v-for="tag in tagsMore.visible.value"
        :key="tag"
        :tag="tag"
        :collapsed="isCollapsed"
      />
      <SidebarMoreButton
        :hidden-count="tagsMore.hiddenCount.value"
        :expanded="tagsMore.isExpanded.value"
        :can-collapse="tagsMore.canCollapse.value"
        @toggle="tagsMore.toggle()"
      />
    </UiSidebarMenu>
  </SidebarSection>
</template>
