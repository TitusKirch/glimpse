<script setup lang="ts">
// Ctrl/Cmd+K command palette: quick actions, branch switching and recent-repo
// reopen. Built on the shadcn command component; selecting an item closes the
// palette and runs the action.
import { open as openDialog } from '@tauri-apps/plugin-dialog';

const { open, hide } = useCommandPalette();
const settings = useSettingsDialog();
const help = useHelpDialog();
const repo = useRepoStore();
const recent = useRecentStore();
const layout = useLayoutStore();
const colorMode = useColorMode();
const { t, locale } = useI18n();

const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';

// Extra search terms for an item: its label translated into each configured
// additional search locale (minus the active one, which the visible label
// already covers). Empty unless the user opts in under Settings → Language, so
// by default search behaves exactly as before.
function kw(key: string): string {
  return (layout.searchLocales ?? [])
    .filter((l) => l !== locale.value)
    .map((l) => t(key, {}, { locale: l }))
    .join(' ');
}

// Nested branch verb page: null = root list, otherwise the active branch action.
// CommandBranchPage renders the branch list for the mode; we keep the page state
// (plus input + back-navigation) here because the single search input lives here.
type BranchPage = 'switch' | 'rename' | 'delete' | 'merge';
const page = ref<BranchPage | null>(null);

// Live search query, mirrored from the command input. We clear it on every page
// transition so a leftover query (e.g. "switch", typed to reach the verb) does
// not filter the nested branch list down to nothing.
const search = ref('');

// Always return to the root list when the palette closes, so the next open
// starts fresh.
watch(open, (isOpen) => {
  if (!isOpen) {
    page.value = null;
    search.value = '';
  }
});

function openPage(p: BranchPage) {
  search.value = '';
  page.value = p;
}

function back() {
  search.value = '';
  page.value = null;
}

// Backspace on an empty input, or Esc, steps back out of a nested page before
// the dialog itself closes. Stop propagation so reka-ui's Dialog doesn't also
// act on the Esc while we're still one level deep.
function onInputKeydown(e: KeyboardEvent) {
  if (!page.value) return;
  const input = e.target as HTMLInputElement;
  if (e.key === 'Escape' || (e.key === 'Backspace' && input.value === '')) {
    e.preventDefault();
    e.stopPropagation();
    back();
  }
}

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
    <UiCommandInput
      v-model:search="search"
      :placeholder="page ? t('command.pickBranch') : t('command.placeholder')"
      @keydown="onInputKeydown"
    />
    <UiCommandList>
      <UiCommandEmpty>{{ t('command.empty') }}</UiCommandEmpty>

      <!-- Nested branch verb page (switch/rename/delete/merge). -->
      <CommandBranchPage v-if="page" :mode="page" :run="run" @back="back" />

      <template v-else>
        <!-- Git: fetch / pull / push and friends, stash, tags. -->
        <UiCommandGroup v-if="repo.hasRepos" :heading="t('command.git')">
          <UiCommandItem
            value="fetch"
            :keywords="kw('sync.fetch')"
            @select="run(() => repo.sync('fetch'))"
          >
            <NuxtIcon name="lucide:download" />
            {{ t('sync.fetch') }}
            <UiCommandShortcut>{{ mod }}+⇧+F</UiCommandShortcut>
          </UiCommandItem>
          <UiCommandItem
            value="pull"
            :keywords="kw('sync.pull')"
            @select="run(() => repo.sync('pull'))"
          >
            <NuxtIcon name="lucide:arrow-down" />
            {{ t('sync.pull') }}
            <UiCommandShortcut>{{ mod }}+⇧+L</UiCommandShortcut>
          </UiCommandItem>
          <UiCommandItem
            value="push"
            :keywords="kw('sync.push')"
            @select="run(() => repo.sync('push'))"
          >
            <NuxtIcon name="lucide:arrow-up" />
            {{ t('sync.push') }}
            <UiCommandShortcut>{{ mod }}+⇧+U</UiCommandShortcut>
          </UiCommandItem>
          <UiCommandItem
            value="push set upstream publish"
            :keywords="kw('command.pushUpstream')"
            @select="run(() => repo.push(true, false))"
          >
            <NuxtIcon name="lucide:cloud-upload" />
            {{ t('command.pushUpstream') }}
          </UiCommandItem>
          <UiCommandItem
            value="push force with lease"
            :keywords="kw('command.pushForce')"
            @select="run(() => repo.push(false, true))"
          >
            <NuxtIcon name="lucide:triangle-alert" />
            {{ t('command.pushForce') }}
          </UiCommandItem>
          <UiCommandItem
            value="stash changes"
            :keywords="kw('command.stash')"
            @select="run(() => repo.stashSave())"
          >
            <NuxtIcon name="lucide:archive" />
            {{ t('command.stash') }}
          </UiCommandItem>
          <UiCommandItem
            value="push tags"
            :keywords="kw('command.pushTags')"
            @select="run(() => repo.pushTags())"
          >
            <NuxtIcon name="lucide:tags" />
            {{ t('command.pushTags') }}
          </UiCommandItem>
        </UiCommandGroup>

        <!-- Branch verbs: each opens a nested branch picker (see page state). -->
        <UiCommandGroup
          v-if="repo.branches.length"
          :heading="t('command.branchActions')"
        >
          <UiCommandItem
            value="switch branch checkout"
            :keywords="kw('command.switchBranch')"
            @select="openPage('switch')"
          >
            <NuxtIcon name="lucide:git-branch" />
            {{ t('command.switchBranch') }}
          </UiCommandItem>
          <UiCommandItem
            value="rename branch"
            :keywords="kw('command.renameBranch')"
            @select="openPage('rename')"
          >
            <NuxtIcon name="lucide:pencil" />
            {{ t('command.renameBranch') }}
          </UiCommandItem>
          <UiCommandItem
            value="merge branch into current"
            :keywords="kw('command.mergeBranch')"
            @select="openPage('merge')"
          >
            <NuxtIcon name="lucide:git-merge" />
            {{ t('command.mergeBranch') }}
          </UiCommandItem>
          <UiCommandItem
            value="delete branch"
            :keywords="kw('command.deleteBranch')"
            @select="openPage('delete')"
          >
            <NuxtIcon name="lucide:trash-2" />
            {{ t('command.deleteBranch') }}
          </UiCommandItem>
        </UiCommandGroup>

        <!-- Flat branch names: direct name search jumps straight to checkout. -->
        <UiCommandGroup
          v-if="repo.branches.length"
          :heading="t('command.localBranches')"
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

        <UiCommandGroup
          v-if="repo.remoteBranches.length"
          :heading="t('command.remoteBranches')"
        >
          <UiCommandItem
            v-for="r in repo.remoteBranches"
            :key="r"
            :value="`remote ${r}`"
            @select="run(() => repo.checkoutRemote(r))"
          >
            <NuxtIcon name="lucide:cloud" />
            {{ r }}
          </UiCommandItem>
        </UiCommandGroup>

        <!-- Repository: open a repo, refresh its data, hand off to an external app. -->
        <UiCommandGroup :heading="t('command.repository')">
          <UiCommandItem
            value="open repository"
            :keywords="kw('actions.openRepo')"
            @select="run(pickFolder)"
          >
            <NuxtIcon name="lucide:folder-open" />
            {{ t('actions.openRepo') }}
          </UiCommandItem>

          <template v-if="repo.hasRepos">
            <UiCommandItem
              value="refresh"
              :keywords="kw('actions.refresh')"
              @select="run(() => repo.refresh())"
            >
              <NuxtIcon name="lucide:refresh-cw" />
              {{ t('actions.refresh') }}
            </UiCommandItem>
            <UiCommandItem
              value="open in file manager"
              :keywords="kw('command.openFiles')"
              @select="run(() => repo.openIn('files'))"
            >
              <NuxtIcon name="lucide:folder" />
              {{ t('command.openFiles') }}
            </UiCommandItem>
            <UiCommandItem
              value="open in terminal"
              :keywords="kw('command.openTerminal')"
              @select="run(() => repo.openIn('terminal'))"
            >
              <NuxtIcon name="lucide:square-terminal" />
              {{ t('command.openTerminal') }}
            </UiCommandItem>
            <UiCommandItem
              value="open in editor"
              :keywords="kw('command.openEditor')"
              @select="run(() => repo.openIn('editor'))"
            >
              <NuxtIcon name="lucide:code" />
              {{ t('command.openEditor') }}
            </UiCommandItem>
          </template>
        </UiCommandGroup>

        <!-- View: appearance and app-level toggles. -->
        <UiCommandGroup :heading="t('command.view')">
          <UiCommandItem
            value="toggle theme"
            :keywords="kw('theme.toggle')"
            @select="run(toggleTheme)"
          >
            <NuxtIcon name="lucide:sun-moon" />
            {{ t('theme.toggle') }}
          </UiCommandItem>
          <UiCommandItem
            value="toggle sidebar"
            :keywords="kw('command.toggleSidebar')"
            @select="run(() => layout.setSidebarOpen(!layout.sidebarOpen))"
          >
            <NuxtIcon name="lucide:panel-left" />
            {{ t('command.toggleSidebar') }}
            <UiCommandShortcut>{{ mod }}+B</UiCommandShortcut>
          </UiCommandItem>
          <UiCommandItem
            value="settings"
            :keywords="kw('settings.title')"
            @select="run(settings.show)"
          >
            <NuxtIcon name="lucide:settings" />
            {{ t('settings.title') }}
            <UiCommandShortcut>{{ mod }}+,</UiCommandShortcut>
          </UiCommandItem>
          <UiCommandItem
            value="keyboard shortcuts help"
            :keywords="kw('help.title')"
            @select="run(help.show)"
          >
            <NuxtIcon name="lucide:keyboard" />
            {{ t('help.title') }}
            <UiCommandShortcut>{{ mod }}+/</UiCommandShortcut>
          </UiCommandItem>
        </UiCommandGroup>

        <UiCommandGroup
          v-if="recent.repos.length"
          :heading="t('command.recent')"
        >
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
      </template>
    </UiCommandList>
  </UiCommandDialog>
</template>
