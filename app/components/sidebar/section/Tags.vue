<script setup lang="ts">
import { useSidebar } from '@/components/ui/sidebar';

const repo = useRepoStore();
const { t } = useI18n();

const { state, isMobile } = useSidebar();
const isCollapsed = computed(
  () => state.value === 'collapsed' && !isMobile.value
);

const tagsMore = useSidebarMore({ items: () => repo.tags });
</script>

<template>
  <SidebarSection section-id="tags" :label="t('sidebar.tags')">
    <template #action>
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
    </template>
    <UiSidebarMenu>
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
