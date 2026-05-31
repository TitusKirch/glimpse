<script setup lang="ts">
// Ctrl/Cmd+K command palette: quick actions, branch switching and recent-repo
// reopen. Built on the shadcn command component; selecting an item closes the
// palette and runs the action.
import { open as openDialog } from '@tauri-apps/plugin-dialog';

const { open, hide } = useCommandPalette();
const settings = useSettingsDialog();
const repo = useRepoStore();
const recent = useRecentStore();
const layout = useLayoutStore();
const colorMode = useColorMode();
const { t } = useI18n();

const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';

// Close first so the dialog is gone before any follow-up dialog (folder picker)
// opens, then run the action.
function run(fn: () => void | Promise<void>) {
  hide();
  void fn();
}

async function pickFolder() {
  if (!isTauri()) return;
  const path = await openDialog({
    directory: true,
    multiple: false,
    title: t('actions.openRepo')
  });
  if (typeof path === 'string') await repo.openRepo(path);
}

function toggleTheme() {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark';
}
</script>

<template>
  <UiCommandDialog v-model:open="open">
    <UiCommandInput :placeholder="t('command.placeholder')" />
    <UiCommandList>
      <UiCommandEmpty>{{ t('command.empty') }}</UiCommandEmpty>

      <UiCommandGroup :heading="t('command.actions')">
        <UiCommandItem value="open repository" @select="run(pickFolder)">
          <NuxtIcon name="lucide:folder-open" />
          {{ t('actions.openRepo') }}
        </UiCommandItem>

        <template v-if="repo.hasRepos">
          <UiCommandItem value="fetch" @select="run(() => repo.sync('fetch'))">
            <NuxtIcon name="lucide:download" />
            {{ t('sync.fetch') }}
            <UiCommandShortcut>{{ mod }}+⇧+F</UiCommandShortcut>
          </UiCommandItem>
          <UiCommandItem value="pull" @select="run(() => repo.sync('pull'))">
            <NuxtIcon name="lucide:arrow-down" />
            {{ t('sync.pull') }}
            <UiCommandShortcut>{{ mod }}+⇧+L</UiCommandShortcut>
          </UiCommandItem>
          <UiCommandItem value="push" @select="run(() => repo.sync('push'))">
            <NuxtIcon name="lucide:arrow-up" />
            {{ t('sync.push') }}
            <UiCommandShortcut>{{ mod }}+⇧+U</UiCommandShortcut>
          </UiCommandItem>
          <UiCommandItem
            value="push set upstream publish"
            @select="run(() => repo.push(true, false))"
          >
            <NuxtIcon name="lucide:cloud-upload" />
            {{ t('command.pushUpstream') }}
          </UiCommandItem>
          <UiCommandItem
            value="push force with lease"
            @select="run(() => repo.push(false, true))"
          >
            <NuxtIcon name="lucide:triangle-alert" />
            {{ t('command.pushForce') }}
          </UiCommandItem>
          <UiCommandItem value="refresh" @select="run(() => repo.refresh())">
            <NuxtIcon name="lucide:refresh-cw" />
            {{ t('actions.refresh') }}
          </UiCommandItem>

          <UiCommandItem
            value="open in file manager"
            @select="run(() => repo.openIn('files'))"
          >
            <NuxtIcon name="lucide:folder" />
            {{ t('command.openFiles') }}
          </UiCommandItem>
          <UiCommandItem
            value="open in terminal"
            @select="run(() => repo.openIn('terminal'))"
          >
            <NuxtIcon name="lucide:square-terminal" />
            {{ t('command.openTerminal') }}
          </UiCommandItem>
          <UiCommandItem
            value="open in editor"
            @select="run(() => repo.openIn('editor'))"
          >
            <NuxtIcon name="lucide:code" />
            {{ t('command.openEditor') }}
          </UiCommandItem>
        </template>

        <UiCommandItem value="toggle theme" @select="run(toggleTheme)">
          <NuxtIcon name="lucide:sun-moon" />
          {{ t('theme.toggle') }}
        </UiCommandItem>
        <UiCommandItem
          value="toggle sidebar"
          @select="run(() => layout.setSidebarOpen(!layout.sidebarOpen))"
        >
          <NuxtIcon name="lucide:panel-left" />
          {{ t('command.toggleSidebar') }}
          <UiCommandShortcut>{{ mod }}+B</UiCommandShortcut>
        </UiCommandItem>
        <UiCommandItem value="settings" @select="run(settings.show)">
          <NuxtIcon name="lucide:settings" />
          {{ t('settings.title') }}
          <UiCommandShortcut>{{ mod }}+,</UiCommandShortcut>
        </UiCommandItem>
      </UiCommandGroup>

      <UiCommandGroup
        v-if="repo.branches.length"
        :heading="t('command.branches')"
      >
        <UiCommandItem
          v-for="b in repo.branches"
          :key="b.name"
          :value="`branch ${b.name}`"
          @select="run(() => repo.checkout(b.name))"
        >
          <NuxtIcon name="lucide:git-branch" />
          {{ b.name }}
          <UiCommandShortcut v-if="b.name === repo.currentBranch">
            {{ t('command.current') }}
          </UiCommandShortcut>
        </UiCommandItem>
      </UiCommandGroup>

      <UiCommandGroup v-if="recent.repos.length" :heading="t('command.recent')">
        <UiCommandItem
          v-for="r in recent.repos"
          :key="r.path"
          :value="`recent ${r.name} ${r.path}`"
          @select="run(() => repo.openRepo(r.path))"
        >
          <NuxtIcon name="lucide:history" />
          <span class="min-w-0 flex-1 truncate">{{ r.name }}</span>
          <span class="ml-2 truncate text-xs text-muted-foreground">{{
            r.path
          }}</span>
        </UiCommandItem>
      </UiCommandGroup>
    </UiCommandList>
  </UiCommandDialog>
</template>
