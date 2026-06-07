<script setup lang="ts">
// Review & commit hunks for the active changelist (issue #106, option 1): a
// self-contained commit workbench — write the message and pick which hunks of
// each file go in, all in one place. The selection is ephemeral (nothing
// sub-file is persisted), so it can't drift as the file changes. On confirm it
// stages exactly the chosen files/hunks and commits, leaving the rest in the
// working tree. Opt-in (settings.changelistHunkCommit); mounted once in app.vue.
const { open, hide } = useOverlay('commitReview');
const repo = useRepoStore();
const changelists = useChangelistsStore();
const { t } = useI18n();

const state = computed(() => changelists.forRepo(repo.repoPath));
const activeList = computed(
  () =>
    state.value.lists.find((l) => l.id === state.value.activeId) ??
    state.value.lists[0]
);

// Each file's hunks (from the working-tree diff). A file with no hunks (binary,
// untracked) commits whole.
interface ReviewFile {
  path: string;
  hunks: string[];
}
const files = ref<ReviewFile[]>([]);
const loading = ref(false);
// Per-file selected hunk indices (files that have hunks), and the set of
// whole-file (no-hunk) paths to include. A file is committed when it has ≥1
// selected hunk, or is a whole-file that's included.
const selectedHunks = reactive(new Map<string, Set<number>>());
const wholeIncluded = reactive(new Set<string>());
const collapsed = reactive(new Set<string>());

async function load() {
  loading.value = true;
  files.value = [];
  selectedHunks.clear();
  wholeIncluded.clear();
  collapsed.clear();
  const members = activeList.value?.members ?? [];
  const loaded = await Promise.all(
    members.map(async (path) => {
      const diff = await gitClient.fileDiff({
        path: repo.repoPath,
        file: path,
        staged: false
      });
      return { path, hunks: diff?.hunks ?? [] };
    })
  );
  files.value = loaded;
  for (const f of loaded) {
    if (f.hunks.length)
      selectedHunks.set(f.path, new Set(f.hunks.map((_, i) => i)));
    else wholeIncluded.add(f.path);
  }
  loading.value = false;
}
watch(open, (isOpen) => {
  if (isOpen) void load();
});

function isHunkSelected(path: string, i: number): boolean {
  return selectedHunks.get(path)?.has(i) ?? false;
}
function toggleHunk(path: string, i: number) {
  const set = selectedHunks.get(path) ?? new Set<number>();
  if (set.has(i)) set.delete(i);
  else set.add(i);
  selectedHunks.set(path, set);
}
// Tri-state per file: 'all' | 'some' | 'none'.
function fileState(f: ReviewFile): 'all' | 'some' | 'none' {
  if (!f.hunks.length) return wholeIncluded.has(f.path) ? 'all' : 'none';
  const n = selectedHunks.get(f.path)?.size ?? 0;
  return n === 0 ? 'none' : n === f.hunks.length ? 'all' : 'some';
}
function toggleFile(f: ReviewFile) {
  if (!f.hunks.length) {
    if (wholeIncluded.has(f.path)) wholeIncluded.delete(f.path);
    else wholeIncluded.add(f.path);
    return;
  }
  const all = (selectedHunks.get(f.path)?.size ?? 0) === f.hunks.length;
  selectedHunks.set(
    f.path,
    all ? new Set() : new Set(f.hunks.map((_, i) => i))
  );
}
function toggleCollapse(path: string) {
  if (collapsed.has(path)) collapsed.delete(path);
  else collapsed.add(path);
}
function selectAll() {
  for (const f of files.value) {
    if (f.hunks.length)
      selectedHunks.set(f.path, new Set(f.hunks.map((_, i) => i)));
    else wholeIncluded.add(f.path);
  }
}
function selectNone() {
  for (const f of files.value) selectedHunks.set(f.path, new Set());
  wholeIncluded.clear();
}

// Split a hunk into rows carrying old/new line numbers, for a readable diff.
interface DiffRow {
  old: string;
  cur: string;
  text: string;
  cls: string;
}
function hunkRows(hunk: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const line of hunk.split('\n')) {
    if (line.startsWith('@@')) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (m) {
        oldNo = Number(m[1]);
        newNo = Number(m[2]);
      }
      rows.push({
        old: '',
        cur: '',
        text: line,
        cls: 'text-sky-500 bg-sky-500/5'
      });
    } else if (line.startsWith('+')) {
      rows.push({
        old: '',
        cur: String(newNo++),
        text: line,
        cls: 'bg-green-500/10 text-green-700 dark:text-green-300'
      });
    } else if (line.startsWith('-')) {
      rows.push({
        old: String(oldNo++),
        cur: '',
        text: line,
        cls: 'bg-red-500/10 text-red-700 dark:text-red-300'
      });
    } else {
      rows.push({
        old: String(oldNo++),
        cur: String(newNo++),
        text: line,
        cls: 'text-muted-foreground'
      });
    }
  }
  return rows;
}

// The selection to commit: whole file when all hunks (or no hunks) are chosen,
// else just the selected hunk strings; fully-deselected files are dropped.
const selection = computed(() =>
  files.value.flatMap((f) => {
    if (!f.hunks.length)
      return wholeIncluded.has(f.path) ? [{ path: f.path, hunks: [] }] : [];
    const idx = selectedHunks.get(f.path);
    if (!idx || idx.size === 0) return [];
    if (idx.size === f.hunks.length) return [{ path: f.path, hunks: [] }];
    return [{ path: f.path, hunks: f.hunks.filter((_, i) => idx.has(i)) }];
  })
);
const hunkCount = computed(() =>
  selection.value.reduce(
    (n, s) =>
      n +
      (s.hunks.length ||
        (files.value.find((f) => f.path === s.path)?.hunks.length ?? 1)),
    0
  )
);

const subjectLen = computed(
  () => repo.commitMessage.split('\n')[0]?.length ?? 0
);
const subjectClass = computed(() =>
  subjectLen.value > 72
    ? 'text-destructive'
    : subjectLen.value > 50
      ? 'text-warning'
      : 'text-muted-foreground'
);

const hasMessage = computed(() => !!repo.commitMessage.trim());
const canCommit = computed(
  () => hasMessage.value && selection.value.length > 0
);

async function commit() {
  if (!canCommit.value) return;
  await repo.commitPartial(selection.value);
  hide();
}
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent class="flex max-h-[85vh] max-w-2xl flex-col gap-3">
      <UiDialogHeader>
        <UiDialogTitle>{{ t('changes.commitReview.title') }}</UiDialogTitle>
        <UiDialogDescription>
          {{
            t('changes.commitReview.subtitle', {
              name: activeList ? activeList.name : ''
            })
          }}
        </UiDialogDescription>
      </UiDialogHeader>

      <!-- commit message (write & commit in one place) -->
      <div class="relative">
        <textarea
          :value="repo.commitMessage"
          :placeholder="t('changes.commit.placeholder')"
          class="max-h-32 min-h-[3.5rem] w-full resize-none overflow-y-auto rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          @input="
            repo.commitMessage = ($event.target as HTMLTextAreaElement).value
          "
        />
        <span
          class="pointer-events-none absolute right-2 bottom-1.5 font-mono text-[10px]"
          :class="subjectClass"
          >{{ subjectLen }}</span
        >
      </div>

      <div class="flex items-center gap-2 text-xs">
        <UiButton
          variant="outline"
          size="sm"
          class="h-6 px-2"
          @click="selectAll"
        >
          {{ t('changes.commitReview.selectAll') }}
        </UiButton>
        <UiButton
          variant="outline"
          size="sm"
          class="h-6 px-2"
          @click="selectNone"
        >
          {{ t('changes.commitReview.selectNone') }}
        </UiButton>
      </div>

      <div class="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
        <p v-if="loading" class="text-sm text-muted-foreground">
          {{ t('changes.commitReview.loading') }}
        </p>
        <p v-else-if="!files.length" class="text-sm text-muted-foreground">
          {{ t('changes.commitReview.empty') }}
        </p>

        <div
          v-for="f in files"
          v-else
          :key="f.path"
          class="overflow-hidden rounded-md border"
        >
          <div class="flex items-center gap-2 bg-muted/40 px-2 py-1.5 text-xs">
            <button
              type="button"
              class="flex size-4 shrink-0 cursor-pointer items-center justify-center"
              :aria-label="t('changes.select')"
              @click="toggleFile(f)"
            >
              <NuxtIcon
                :name="
                  fileState(f) === 'all'
                    ? 'lucide:square-check'
                    : fileState(f) === 'some'
                      ? 'lucide:square-minus'
                      : 'lucide:square'
                "
                class="size-4"
                :class="
                  fileState(f) === 'none'
                    ? 'text-muted-foreground'
                    : 'text-primary'
                "
              />
            </button>
            <button
              type="button"
              class="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
              @click="f.hunks.length && toggleCollapse(f.path)"
            >
              <NuxtIcon
                v-if="f.hunks.length"
                :name="
                  collapsed.has(f.path)
                    ? 'lucide:chevron-right'
                    : 'lucide:chevron-down'
                "
                class="size-3.5 shrink-0 opacity-60"
              />
              <span class="min-w-0 flex-1 truncate font-mono">{{
                f.path
              }}</span>
            </button>
            <span v-if="!f.hunks.length" class="shrink-0 text-muted-foreground">
              {{ t('changes.commitReview.wholeFile') }}
            </span>
          </div>

          <template v-if="f.hunks.length && !collapsed.has(f.path)">
            <div
              v-for="(hunk, i) in f.hunks"
              :key="i"
              class="border-t"
              :class="!isHunkSelected(f.path, i) && 'opacity-45'"
            >
              <button
                type="button"
                class="flex w-full cursor-pointer items-center gap-2 px-2 py-1 text-left"
                @click="toggleHunk(f.path, i)"
              >
                <NuxtIcon
                  :name="
                    isHunkSelected(f.path, i)
                      ? 'lucide:square-check'
                      : 'lucide:square'
                  "
                  class="size-4 shrink-0"
                  :class="
                    isHunkSelected(f.path, i)
                      ? 'text-primary'
                      : 'text-muted-foreground'
                  "
                />
                <span class="text-[10px] text-muted-foreground">
                  {{ t('changes.commitReview.hunk', { n: i + 1 }) }}
                </span>
              </button>
              <div
                class="overflow-x-auto font-mono text-[11px] leading-relaxed"
              >
                <div
                  v-for="(row, ri) in hunkRows(hunk)"
                  :key="ri"
                  class="flex whitespace-pre"
                  :class="row.cls"
                >
                  <span
                    class="w-8 shrink-0 select-none px-1 text-right text-[10px] text-muted-foreground/50"
                    >{{ row.old }}</span
                  >
                  <span
                    class="w-8 shrink-0 select-none px-1 text-right text-[10px] text-muted-foreground/50"
                    >{{ row.cur }}</span
                  >
                  <span class="flex-1 pr-2">{{ row.text || ' ' }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>

      <div class="flex items-center justify-between gap-2 border-t pt-3">
        <span v-if="!hasMessage" class="text-xs text-muted-foreground">
          {{ t('changes.commitReview.needMessage') }}
        </span>
        <span v-else class="text-xs text-muted-foreground">
          {{
            t('changes.commitReview.summary', {
              files: selection.length,
              hunks: hunkCount
            })
          }}
        </span>
        <div class="flex gap-2">
          <UiButton variant="outline" type="button" @click="hide">
            {{ t('common.cancel') }}
          </UiButton>
          <UiButton type="button" :disabled="!canCommit" @click="commit">
            {{ t('changes.commitReview.commit') }}
          </UiButton>
        </div>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>
