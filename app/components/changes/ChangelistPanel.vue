<script setup lang="ts">
import { z } from 'zod';
import type { StatusEntry } from '@/stores/repo';
import type { Changelist } from '@/utils/changelist';

// The changelist view of the Changes panel: every pending change lives in a
// named list (Default until moved); the active list is what the commit box
// commits. Conflicts stay in their own section (they need resolving first).
const repo = useRepoStore();
const settings = useSettingsStore();
const changelists = useChangelistsStore();
const mergeEditor = useMergeEditor();
const { t } = useI18n();

const nameSchema = z.string().trim().min(1);

// Single, consistent letter per file: A = new/untracked, M = modified,
// D = deleted, R = renamed.
function letter(entry: StatusEntry): string {
  const c = entry.y.trim() || entry.x.trim();
  if (!c || c === '?') return 'A';
  return c;
}

const conflictItems = computed(() =>
  repo.conflictedFiles.map((f) => ({ ...f, status: 'U' }))
);

// Everything except conflicts is grouped into changelists.
const changedPaths = computed(() =>
  repo.status.filter((s) => !s.conflicted).map((s) => s.path)
);

// Re-read membership from the git-native store when switching to / re-opening a
// repo, to pick up edits made by an external tool (the CLI, an agent).
watch(
  () => repo.repoPath,
  (path) => {
    if (path && path !== '.') void changelists.reload(path);
  },
  { immediate: true }
);

// Keep membership in sync with the real working tree — covers commits, discards
// and any git run on the side. Runs whenever the changed-paths set changes (it
// awaits the initial load first, so a slow read can't lose the reconcile).
watch(
  changedPaths,
  () => {
    if (repo.repoPath && repo.repoPath !== '.')
      void changelists.sync(repo.repoPath, changedPaths.value);
  },
  { immediate: true }
);

const state = computed(() => changelists.forRepo(repo.repoPath));
const activeList = computed(
  () =>
    state.value.lists.find((l) => l.id === state.value.activeId) ??
    state.value.lists[0]
);

const entryByPath = computed(() => {
  const m = new Map<string, StatusEntry>();
  for (const e of repo.status) m.set(e.path, e);
  return m;
});

// FileTree items for a list (resolve each member path to its status entry).
function itemsFor(list: Changelist) {
  return list.members
    .map((p) => entryByPath.value.get(p))
    .filter((e): e is StatusEntry => !!e)
    .map((e) => ({ ...e, status: letter(e) }));
}

function listLabel(list: Changelist): string {
  return list.id === DEFAULT_ID ? t('changes.changelist.default') : list.name;
}

async function newList() {
  const name = await usePrompt().prompt({
    titleKey: 'changes.changelist.newList',
    labelKey: 'changes.changelist.nameLabel',
    placeholderKey: 'changes.changelist.namePlaceholder',
    submitKey: 'form.create',
    schema: nameSchema
  });
  if (name)
    changelists.setActive(
      repo.repoPath,
      changelists.createList(repo.repoPath, name)
    );
}

async function renameList(id: string) {
  const name = await usePrompt().prompt({
    titleKey: 'changes.changelist.renameList',
    labelKey: 'changes.changelist.nameLabel',
    placeholderKey: 'changes.changelist.namePlaceholder',
    submitKey: 'form.rename',
    initial: state.value.lists.find((l) => l.id === id)?.name,
    schema: nameSchema
  });
  if (name) changelists.renameList(repo.repoPath, id, name);
}

function commitActive() {
  repo.commitList(activeList.value?.members ?? []);
}

// Per-list collapse, remembered for the session (keyed by repo + list id so it
// survives switching repos and back).
const collapsed = reactive(new Set<string>());
const collapseKey = (id: string) => `${repo.repoPath}::${id}`;
const isCollapsed = (id: string) => collapsed.has(collapseKey(id));
function toggleCollapsed(id: string) {
  const k = collapseKey(id);
  if (collapsed.has(k)) collapsed.delete(k);
  else collapsed.add(k);
}

// The commit box targets the active list — surface its name there so it is never
// ambiguous which list the commit button will commit.
const commitContext = computed(() =>
  activeList.value
    ? t('changes.changelist.committing', { name: listLabel(activeList.value) })
    : ''
);

function moveAll(fromId: string, toId: string) {
  changelists.moveAll(repo.repoPath, fromId, toId);
}

// Quick one-click add: move a file straight into the active list.
function addToActive(path: string) {
  if (activeList.value)
    changelists.moveFile(repo.repoPath, path, activeList.value.id);
}

// Multi-select across all lists, for bulk moves. Panel-level so files from any
// list can be selected together.
const selected = reactive(new Set<string>());
function toggleSelect(path: string) {
  if (selected.has(path)) selected.delete(path);
  else selected.add(path);
}
function clearSelection() {
  selected.clear();
}
function moveSelected(toId: string) {
  for (const p of Array.from(selected))
    changelists.moveFile(repo.repoPath, p, toId);
  selected.clear();
}
// Drop selected paths that are no longer changed (committed / discarded), and
// reset selection when switching repos.
watch(changedPaths, (paths) => {
  const live = new Set(paths);
  for (const p of Array.from(selected)) if (!live.has(p)) selected.delete(p);
});
watch(
  () => repo.repoPath,
  () => selected.clear()
);
</script>

<template>
  <div class="flex h-full flex-col text-sm">
    <FileViewToggle class="border-b" />
    <ChangesBanners />

    <div class="min-h-0 flex-1 overflow-auto">
      <!-- loading skeleton -->
      <div v-if="repo.loading && !repo.status.length" class="space-y-2 p-3">
        <UiSkeleton v-for="n in 6" :key="n" class="h-6 w-full" />
      </div>

      <!-- merge conflicts (not part of changelists — resolve first) -->
      <section v-if="repo.conflictedFiles.length" class="px-1">
        <h3
          class="sticky top-0 z-10 bg-background px-2 py-1.5 text-xs font-semibold tracking-wide text-warning uppercase"
        >
          {{ t('changes.conflicts') }} ({{ repo.conflictedFiles.length }})
        </h3>
        <FileTree
          :files="conflictItems"
          :view="settings.fileView"
          :selected="!repo.selectedFileStaged ? repo.selectedFile : null"
          @select="(p) => repo.selectFile({ file: p, staged: false })"
        >
          <template #actions="{ file }">
            <UiDropdownMenu>
              <UiDropdownMenuTrigger as-child>
                <UiButton
                  variant="ghost"
                  size="icon"
                  class="size-5 opacity-0 group-hover:opacity-100"
                  icon="lucide:ellipsis"
                  icon-size="sm"
                  :aria-label="t('actions.more')"
                  @click.stop
                />
              </UiDropdownMenuTrigger>
              <UiDropdownMenuContent align="end">
                <UiDropdownMenuItem @click="mergeEditor.show(file.path)">
                  <NuxtIcon name="lucide:git-merge" />
                  {{ t('merge.open') }}
                </UiDropdownMenuItem>
                <UiDropdownMenuSeparator />
                <UiDropdownMenuItem
                  @click="
                    repo.resolveConflict({ file: file.path, side: 'ours' })
                  "
                >
                  {{ t('changes.useOurs') }}
                </UiDropdownMenuItem>
                <UiDropdownMenuItem
                  @click="
                    repo.resolveConflict({ file: file.path, side: 'theirs' })
                  "
                >
                  {{ t('changes.useTheirs') }}
                </UiDropdownMenuItem>
                <UiDropdownMenuSeparator />
                <UiDropdownMenuItem
                  @click="
                    repo.resolveConflict({ file: file.path, side: 'mark' })
                  "
                >
                  {{ t('changes.markResolved') }}
                </UiDropdownMenuItem>
              </UiDropdownMenuContent>
            </UiDropdownMenu>
          </template>
        </FileTree>
      </section>

      <!-- changelists toolbar -->
      <div
        v-if="!repo.loading || repo.status.length"
        class="flex items-center gap-2 px-2 pt-2 pb-1"
      >
        <span
          class="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {{ t('changes.changelist.title') }}
        </span>
        <UiTooltip>
          <UiTooltipTrigger as-child>
            <UiButton
              variant="ghost"
              size="icon"
              class="ml-auto size-5"
              icon="lucide:plus"
              icon-size="sm"
              :aria-label="t('changes.changelist.newList')"
              @click="newList"
            />
          </UiTooltipTrigger>
          <UiTooltipContent>{{
            t('changes.changelist.newList')
          }}</UiTooltipContent>
        </UiTooltip>
      </div>

      <!-- bulk action bar (visible while files are selected) -->
      <div
        v-if="selected.size"
        class="mx-1 mb-1 flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5 text-xs"
      >
        <span class="font-medium">{{
          t('changes.changelist.selected', { n: selected.size })
        }}</span>
        <UiDropdownMenu>
          <UiDropdownMenuTrigger as-child>
            <UiButton
              size="sm"
              variant="outline"
              class="h-6 gap-1 px-2 text-xs"
            >
              <NuxtIcon name="lucide:folder-input" class="size-3" />
              {{ t('changes.changelist.moveSelected') }}
              <NuxtIcon name="lucide:chevron-down" class="size-3 opacity-60" />
            </UiButton>
          </UiDropdownMenuTrigger>
          <UiDropdownMenuContent align="start">
            <UiDropdownMenuItem
              v-for="l in state.lists"
              :key="l.id"
              @click="moveSelected(l.id)"
            >
              {{ listLabel(l) }}
            </UiDropdownMenuItem>
          </UiDropdownMenuContent>
        </UiDropdownMenu>
        <UiButton
          size="sm"
          variant="ghost"
          class="ml-auto h-6 px-2 text-xs"
          @click="clearSelection"
        >
          {{ t('changes.changelist.clearSelection') }}
        </UiButton>
      </div>

      <!-- one section per changelist -->
      <section
        v-for="list in state.lists"
        :key="list.id"
        class="group/cl px-1"
        :class="list.id === state.activeId && 'rounded-md bg-primary/5'"
      >
        <div
          class="sticky top-0 z-10 flex items-center gap-1 bg-background px-2 py-1.5 text-xs font-semibold tracking-wide uppercase"
          :class="
            list.id === state.activeId
              ? 'text-foreground'
              : 'text-muted-foreground'
          "
        >
          <button
            type="button"
            class="flex size-5 shrink-0 cursor-pointer items-center justify-center opacity-60 hover:opacity-100"
            :aria-label="t('changes.changelist.collapse')"
            @click="toggleCollapsed(list.id)"
          >
            <NuxtIcon
              :name="
                isCollapsed(list.id)
                  ? 'lucide:chevron-right'
                  : 'lucide:chevron-down'
              "
              class="size-3.5"
            />
          </button>
          <button
            type="button"
            class="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
            :aria-label="t('changes.changelist.setActive')"
            @click="changelists.setActive(repo.repoPath, list.id)"
          >
            <NuxtIcon
              :name="
                list.id === state.activeId
                  ? 'lucide:circle-dot'
                  : 'lucide:circle'
              "
              class="size-3 shrink-0"
              :class="
                list.id === state.activeId ? 'text-primary' : 'opacity-40'
              "
            />
            <span class="truncate">{{ listLabel(list) }}</span>
            <span class="opacity-60">({{ list.members.length }})</span>
          </button>
          <UiDropdownMenu>
            <UiDropdownMenuTrigger as-child>
              <UiButton
                variant="ghost"
                size="icon"
                class="size-5 opacity-0 group-hover/cl:opacity-100"
                icon="lucide:ellipsis"
                icon-size="sm"
                :aria-label="t('actions.more')"
              />
            </UiDropdownMenuTrigger>
            <UiDropdownMenuContent align="end">
              <UiDropdownMenuItem
                @click="changelists.setActive(repo.repoPath, list.id)"
              >
                <NuxtIcon name="lucide:circle-dot" />
                {{ t('changes.changelist.setActive') }}
              </UiDropdownMenuItem>
              <UiDropdownMenuItem @click="renameList(list.id)">
                <NuxtIcon name="lucide:pencil" />
                {{ t('form.rename') }}
              </UiDropdownMenuItem>
              <UiDropdownMenuSub
                v-if="list.members.length && state.lists.length > 1"
              >
                <UiDropdownMenuSubTrigger>
                  <NuxtIcon name="lucide:folder-input" />
                  {{ t('changes.changelist.moveAll') }}
                </UiDropdownMenuSubTrigger>
                <UiDropdownMenuSubContent>
                  <UiDropdownMenuItem
                    v-for="other in state.lists.filter((l) => l.id !== list.id)"
                    :key="other.id"
                    @click="moveAll(list.id, other.id)"
                  >
                    {{ listLabel(other) }}
                  </UiDropdownMenuItem>
                </UiDropdownMenuSubContent>
              </UiDropdownMenuSub>
              <template v-if="list.id !== DEFAULT_ID">
                <UiDropdownMenuSeparator />
                <UiDropdownMenuItem
                  class="text-destructive focus:text-destructive"
                  @click="changelists.deleteList(repo.repoPath, list.id)"
                >
                  <NuxtIcon name="lucide:trash-2" />
                  {{ t('changes.changelist.delete') }}
                </UiDropdownMenuItem>
              </template>
            </UiDropdownMenuContent>
          </UiDropdownMenu>
        </div>

        <template v-if="!isCollapsed(list.id)">
          <p
            v-if="!list.members.length"
            class="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground/70 italic"
          >
            <NuxtIcon name="lucide:minus" class="size-3 shrink-0" />
            {{ t('changes.changelist.empty') }}
          </p>
          <FileTree
            v-else
            :files="itemsFor(list)"
            :view="settings.fileView"
            :selected="!repo.selectedFileStaged ? repo.selectedFile : null"
            selectable
            :selected-set="selected"
            @select="(p) => repo.selectFile({ file: p, staged: false })"
            @toggle="toggleSelect"
          >
            <template #actions="{ file }">
              <UiButton
                v-if="list.id !== state.activeId"
                variant="ghost"
                size="icon"
                class="size-5 opacity-0 group-hover:opacity-100"
                icon="lucide:corner-up-right"
                icon-size="sm"
                :aria-label="t('changes.changelist.addToActive')"
                @click.stop="addToActive(file.path)"
              />
              <UiDropdownMenu>
                <UiDropdownMenuTrigger as-child>
                  <UiButton
                    variant="ghost"
                    size="icon"
                    class="size-5 opacity-0 group-hover:opacity-100"
                    icon="lucide:ellipsis"
                    icon-size="sm"
                    :aria-label="t('actions.more')"
                    @click.stop
                  />
                </UiDropdownMenuTrigger>
                <UiDropdownMenuContent align="end">
                  <UiDropdownMenuSub v-if="state.lists.length > 1">
                    <UiDropdownMenuSubTrigger>
                      <NuxtIcon name="lucide:folder-input" />
                      {{ t('changes.changelist.moveTo') }}
                    </UiDropdownMenuSubTrigger>
                    <UiDropdownMenuSubContent>
                      <UiDropdownMenuItem
                        v-for="other in state.lists.filter(
                          (l) => l.id !== list.id
                        )"
                        :key="other.id"
                        @click="
                          changelists.moveFile(
                            repo.repoPath,
                            file.path,
                            other.id
                          )
                        "
                      >
                        {{ listLabel(other) }}
                      </UiDropdownMenuItem>
                    </UiDropdownMenuSubContent>
                  </UiDropdownMenuSub>
                  <UiDropdownMenuSeparator v-if="state.lists.length > 1" />
                  <UiDropdownMenuItem
                    class="text-destructive focus:text-destructive"
                    @click="
                      repo.discard({
                        file: file.path,
                        untracked: file.untracked
                      })
                    "
                  >
                    <NuxtIcon name="lucide:undo-2" />
                    {{ t('changes.discard') }}
                  </UiDropdownMenuItem>
                </UiDropdownMenuContent>
              </UiDropdownMenu>
            </template>
          </FileTree>
        </template>
      </section>

      <EmptyState
        v-if="!repo.loading && !repo.status.length"
        icon="lucide:check"
        :title="t('changes.clean')"
        :description="t('changes.cleanHint')"
      />
    </div>

    <!-- commit box (commits the active changelist) -->
    <ChangesCommitBox
      :count="activeList?.members.length ?? 0"
      :context-label="commitContext"
      @submit="commitActive"
    />
  </div>
</template>
