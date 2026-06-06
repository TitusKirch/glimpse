<script setup lang="ts">
const repo = useRepoStore();
const remoteDialog = useOverlay('remote');
const { t } = useI18n();

// Dismiss the action's tooltip as the dialog opens (it otherwise sticks over it).
const { open: actionTip, onActivate } = useDismissableTooltip();
</script>

<template>
  <SidebarSection section-id="remotes" :label="t('sidebar.remotes')">
    <template #action>
      <UiTooltip v-model:open="actionTip">
        <UiTooltipTrigger as-child>
          <UiSidebarGroupAction
            class="size-6 cursor-pointer"
            @click="onActivate(() => remoteDialog.show())"
          >
            <NuxtIcon name="lucide:plus" class="shrink-0" />
          </UiSidebarGroupAction>
        </UiTooltipTrigger>
        <UiTooltipContent>{{ t('sidebar.addRemote') }}</UiTooltipContent>
      </UiTooltip>
    </template>
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
  </SidebarSection>
</template>
