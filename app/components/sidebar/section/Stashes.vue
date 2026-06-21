<script setup lang="ts">
const repo = useRepoStore();
const stashOverlay = useOverlay('stash');
const { t } = useI18n();

// Dismiss the action's tooltip as the overlay opens (it otherwise sticks over it).
const {
  open: actionTip,
  onOpenChange: onActionTipChange,
  hover: actionHover,
  onActivate
} = useDismissableTooltip();
</script>

<template>
  <SidebarSection
    section-id="stashes"
    :label="t('sidebar.stashes')"
    :count="repo.stashes.length"
    :loading="repo.loading"
    :loaded="repo.loaded"
    :empty-label="t('sidebar.noStashes')"
  >
    <template #action>
      <UiTooltip :open="actionTip" @update:open="onActionTipChange">
        <UiTooltipTrigger as-child>
          <UiSidebarGroupAction
            class="size-6 cursor-pointer"
            :aria-label="t('sidebar.stashPush')"
            v-bind="actionHover"
            @click="onActivate(() => stashOverlay.show())"
          >
            <NuxtIcon name="lucide:archive" class="shrink-0" />
          </UiSidebarGroupAction>
        </UiTooltipTrigger>
        <UiTooltipContent>{{ t('sidebar.stashPush') }}</UiTooltipContent>
      </UiTooltip>
    </template>
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
  </SidebarSection>
</template>
