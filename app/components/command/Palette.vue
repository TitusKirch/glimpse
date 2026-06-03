<script setup lang="ts">
// Ctrl/Cmd+K command palette: quick actions, branch switching and recent-repo
// reopen. Built on the shadcn command component; selecting an item closes the
// palette and runs the action. The static commands live in a data registry
// (`actions`) so they can also surface in a "recently used" group at the top.
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useForm } from '@tanstack/vue-form';
import { z } from 'zod';

const { open, hide } = useOverlay('commandPalette');
const settings = useOverlay('settings');
const help = useOverlay('help');
const repo = useRepoStore();
const recent = useRecentStore();
const recentActions = useRecentActionsStore();
const layout = useLayoutStore();
const settingsStore = useSettingsStore();
const colorMode = useColorMode();
const { t, locale } = useI18n();

const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';

// Extra search terms for an item: its label translated into each configured
// additional search locale (minus the active one, which the visible label
// already covers). Empty unless the user opts in under Settings → Language, so
// by default search behaves exactly as before.
function kw(key: string): string {
  return (settingsStore.searchLocales ?? [])
    .filter((l) => l !== locale.value)
    .map((l) => t(key, {}, { locale: l }))
    .join(' ');
}

// Nested branch verb page: null = root list, otherwise the active branch action.
// CommandBranchPage renders the branch list for the mode; we keep the page state
// (plus input + back-navigation) here because the single search input lives here.
type BranchPage = 'switch' | 'rename' | 'delete' | 'merge';
const page = ref<BranchPage | null>(null);

// Live search query, mirrored from the command input. The input is a TanStack
// form field; `search` reads its value and clearSearch() resets it. We clear it
// on every page transition so a leftover query (e.g. "switch", typed to reach
// the verb) does not filter the nested branch list down to nothing.
const searchForm = useForm({
  defaultValues: { search: '' },
  validators: { onChange: z.object({ search: z.string() }) }
});
function clearSearch() {
  searchForm.setFieldValue('search', '');
}

// Snapshot the recently-used action ids when the palette opens. Selecting an
// action re-orders the store immediately, which would make the "recently used"
// list jump while the dialog is still animating closed — so render from this
// frozen snapshot and let the new order show on the next open.
const recentSnapshot = ref<string[]>([]);

// Always return to the root list when the palette closes, so the next open
// starts fresh.
watch(open, (isOpen) => {
  if (isOpen) {
    recentSnapshot.value = recentActions.actions.map((a) => a.id);
  } else {
    page.value = null;
    clearSearch();
  }
});

function openPage(p: BranchPage) {
  clearSearch();
  page.value = p;
}

function back() {
  clearSearch();
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

// Static command registry. Each action has a stable id (for recently-used
// tracking), a group, a label key and either a `run` (executes) or a `page`
// (opens a nested branch picker). `visible` gates on the current repo state.
type ActionGroup = 'git' | 'branch' | 'repository' | 'view';
interface PaletteAction {
  id: string;
  group: ActionGroup;
  icon: string;
  labelKey: string;
  shortcut?: string;
  page?: BranchPage;
  run?: () => void | Promise<void>;
  visible: boolean;
}

const actions = computed<PaletteAction[]>(() => {
  const hasRepos = repo.hasRepos;
  const hasBranches = repo.branches.length > 0;
  // The configured default pull strategy carries the shortcut; the other two
  // are offered as separate, shortcut-less entries (all labelled "Pull (…)").
  const defaultPull = PULL_STRATEGIES.find(
    (s) => s.value === settingsStore.pullStrategy
  );
  return [
    // Git
    {
      id: 'fetch',
      group: 'git',
      icon: 'lucide:download',
      labelKey: 'sync.fetch',
      shortcut: `${mod}+⇧+F`,
      run: () => repo.sync('fetch'),
      visible: hasRepos
    },
    {
      id: 'pull',
      group: 'git',
      icon: 'lucide:arrow-down',
      labelKey: defaultPull?.labelKey ?? 'pull.merge',
      shortcut: `${mod}+⇧+L`,
      run: () => repo.sync('pull'),
      visible: hasRepos
    },
    ...PULL_STRATEGIES.filter(
      (s) => s.value !== settingsStore.pullStrategy
    ).map((s) => ({
      id: `pull-${s.value}`,
      group: 'git' as const,
      icon: s.icon,
      labelKey: s.labelKey,
      run: () => repo.pull({ strategy: s.value }),
      visible: hasRepos
    })),
    {
      id: 'push',
      group: 'git',
      icon: 'lucide:arrow-up',
      labelKey: 'sync.push',
      shortcut: `${mod}+⇧+U`,
      run: () => repo.sync('push'),
      visible: hasRepos
    },
    {
      id: 'push-upstream',
      group: 'git',
      icon: 'lucide:cloud-upload',
      labelKey: 'command.pushUpstream',
      run: () => repo.push({ setUpstream: true, force: false }),
      visible: hasRepos
    },
    {
      id: 'push-force',
      group: 'git',
      icon: 'lucide:triangle-alert',
      labelKey: 'command.pushForce',
      run: () => repo.push({ setUpstream: false, force: true }),
      visible: hasRepos
    },
    {
      id: 'stash',
      group: 'git',
      icon: 'lucide:archive',
      labelKey: 'command.stash',
      run: () => repo.stashSave(),
      visible: hasRepos
    },
    {
      id: 'push-tags',
      group: 'git',
      icon: 'lucide:tags',
      labelKey: 'command.pushTags',
      run: () => repo.pushTags(),
      visible: hasRepos
    },
    // Branch verbs (open a nested picker)
    {
      id: 'switch-branch',
      group: 'branch',
      icon: 'lucide:git-branch',
      labelKey: 'command.switchBranch',
      page: 'switch',
      visible: hasBranches
    },
    {
      id: 'rename-branch',
      group: 'branch',
      icon: 'lucide:pencil',
      labelKey: 'command.renameBranch',
      page: 'rename',
      visible: hasBranches
    },
    {
      id: 'merge-branch',
      group: 'branch',
      icon: 'lucide:git-merge',
      labelKey: 'command.mergeBranch',
      page: 'merge',
      visible: hasBranches
    },
    {
      id: 'delete-branch',
      group: 'branch',
      icon: 'lucide:trash-2',
      labelKey: 'command.deleteBranch',
      page: 'delete',
      visible: hasBranches
    },
    // Repository
    {
      id: 'open-repository',
      group: 'repository',
      icon: 'lucide:folder-open',
      labelKey: 'actions.openRepo',
      run: pickFolder,
      visible: true
    },
    {
      id: 'refresh',
      group: 'repository',
      icon: 'lucide:refresh-cw',
      labelKey: 'actions.refresh',
      run: () => repo.refresh(),
      visible: hasRepos
    },
    {
      id: 'open-files',
      group: 'repository',
      icon: 'lucide:folder',
      labelKey: 'command.openFiles',
      run: () => repo.openIn('files'),
      visible: hasRepos
    },
    {
      id: 'open-terminal',
      group: 'repository',
      icon: 'lucide:square-terminal',
      labelKey: 'command.openTerminal',
      run: () => repo.openIn('terminal'),
      visible: hasRepos
    },
    {
      id: 'open-editor',
      group: 'repository',
      icon: 'lucide:code',
      labelKey: 'command.openEditor',
      run: () => repo.openIn('editor'),
      visible: hasRepos
    },
    // View
    {
      id: 'toggle-theme',
      group: 'view',
      icon: 'lucide:sun-moon',
      labelKey: 'theme.toggle',
      run: toggleTheme,
      visible: true
    },
    {
      id: 'toggle-sidebar',
      group: 'view',
      icon: 'lucide:panel-left',
      labelKey: 'command.toggleSidebar',
      shortcut: `${mod}+B`,
      run: () => layout.setSidebarOpen(!layout.sidebarOpen),
      visible: true
    },
    {
      id: 'settings',
      group: 'view',
      icon: 'lucide:settings',
      labelKey: 'settings.title',
      shortcut: `${mod}+,`,
      run: settings.show,
      visible: true
    },
    {
      id: 'help',
      group: 'view',
      icon: 'lucide:keyboard',
      labelKey: 'help.title',
      shortcut: `${mod}+/`,
      run: help.show,
      visible: true
    }
  ];
});

function groupActions(g: ActionGroup): PaletteAction[] {
  return actions.value.filter((a) => a.group === g && a.visible);
}

// Most-recently-used visible actions, newest first, capped to the configured
// display count. Unknown or currently-hidden ids are skipped.
const recentlyUsed = computed<PaletteAction[]>(() => {
  const byId = new Map(
    actions.value.filter((a) => a.visible).map((a) => [a.id, a])
  );
  return recentSnapshot.value
    .map((id) => byId.get(id))
    .filter((a): a is PaletteAction => Boolean(a))
    .slice(0, settingsStore.recentActionsInSearch);
});

// Record the action as recently used, then run it (or open its branch page).
function selectAction(a: PaletteAction) {
  recentActions.record(a.id);
  if (a.page) openPage(a.page);
  else if (a.run) run(a.run);
}

// Recent repos shown in the palette, capped (and never more than are stored).
const recentReposInSearch = computed(() =>
  recent.repos.slice(
    0,
    Math.min(settingsStore.recentReposInSearch, settingsStore.recentReposMax)
  )
);
</script>

<template>
  <UiCommandDialog v-model:open="open">
    <searchForm.Field v-slot="{ field }" name="search">
      <UiCommandInput
        :search="field.state.value"
        :placeholder="page ? t('command.pickBranch') : t('command.placeholder')"
        @update:search="(v) => field.handleChange(v ?? '')"
        @keydown="onInputKeydown"
      />
    </searchForm.Field>
    <UiCommandList>
      <UiCommandEmpty>{{ t('command.empty') }}</UiCommandEmpty>

      <!-- Nested branch verb page (switch/rename/delete/merge). -->
      <CommandBranchPage v-if="page" :mode="page" :run="run" @back="back" />

      <template v-else>
        <!-- Recently used: most-recent palette actions, newest first. -->
        <UiCommandGroup
          v-if="recentlyUsed.length"
          :heading="t('command.recentActions')"
        >
          <UiCommandItem
            v-for="a in recentlyUsed"
            :key="`recent-${a.id}`"
            :value="`recent-action ${a.id}`"
            :keywords="kw(a.labelKey)"
            @select="selectAction(a)"
          >
            <NuxtIcon :name="a.icon" />
            {{ t(a.labelKey) }}
            <UiCommandShortcut v-if="a.shortcut">{{
              a.shortcut
            }}</UiCommandShortcut>
          </UiCommandItem>
        </UiCommandGroup>

        <!-- Git: fetch / pull / push and friends, stash, tags. -->
        <UiCommandGroup
          v-if="groupActions('git').length"
          :heading="t('command.git')"
        >
          <UiCommandItem
            v-for="a in groupActions('git')"
            :key="a.id"
            :value="`action ${a.id}`"
            :keywords="kw(a.labelKey)"
            @select="selectAction(a)"
          >
            <NuxtIcon :name="a.icon" />
            {{ t(a.labelKey) }}
            <UiCommandShortcut v-if="a.shortcut">{{
              a.shortcut
            }}</UiCommandShortcut>
          </UiCommandItem>
        </UiCommandGroup>

        <!-- Branch verbs: each opens a nested branch picker (see page state). -->
        <UiCommandGroup
          v-if="groupActions('branch').length"
          :heading="t('command.branchActions')"
        >
          <UiCommandItem
            v-for="a in groupActions('branch')"
            :key="a.id"
            :value="`action ${a.id}`"
            :keywords="kw(a.labelKey)"
            @select="selectAction(a)"
          >
            <NuxtIcon :name="a.icon" />
            {{ t(a.labelKey) }}
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
        <UiCommandGroup
          v-if="groupActions('repository').length"
          :heading="t('command.repository')"
        >
          <UiCommandItem
            v-for="a in groupActions('repository')"
            :key="a.id"
            :value="`action ${a.id}`"
            :keywords="kw(a.labelKey)"
            @select="selectAction(a)"
          >
            <NuxtIcon :name="a.icon" />
            {{ t(a.labelKey) }}
          </UiCommandItem>
        </UiCommandGroup>

        <!-- View: appearance and app-level toggles. -->
        <UiCommandGroup
          v-if="groupActions('view').length"
          :heading="t('command.view')"
        >
          <UiCommandItem
            v-for="a in groupActions('view')"
            :key="a.id"
            :value="`action ${a.id}`"
            :keywords="kw(a.labelKey)"
            @select="selectAction(a)"
          >
            <NuxtIcon :name="a.icon" />
            {{ t(a.labelKey) }}
            <UiCommandShortcut v-if="a.shortcut">{{
              a.shortcut
            }}</UiCommandShortcut>
          </UiCommandItem>
        </UiCommandGroup>

        <UiCommandGroup
          v-if="recentReposInSearch.length"
          :heading="t('command.recent')"
        >
          <UiCommandItem
            v-for="r in recentReposInSearch"
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
