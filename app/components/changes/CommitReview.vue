<script setup lang="ts">
// Review & commit hunks for the active changelist (issue #106, option 1): pick
// which hunks of each file go into this commit. The selection is ephemeral —
// nothing sub-file is persisted — so it can never drift as the file changes. On
// confirm it stages exactly the chosen files/hunks and commits, leaving the rest
// in the working tree. Mounted once in app.vue, opened from the changelist panel.
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
// Selected hunk indices per path. A file is included when it has ≥1 selected
// hunk, or when it has no hunks at all (committed whole).
const selected = reactive(new Map<string, Set<number>>());

async function load() {
  loading.value = true;
  files.value = [];
  selected.clear();
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
    selected.set(f.path, new Set(f.hunks.map((_, i) => i)));
  }
  loading.value = false;
}
watch(open, (isOpen) => {
  if (isOpen) void load();
});

function isHunkSelected(path: string, i: number): boolean {
  return selected.get(path)?.has(i) ?? false;
}
function toggleHunk(path: string, i: number) {
  const set = selected.get(path) ?? new Set<number>();
  if (set.has(i)) set.delete(i);
  else set.add(i);
  selected.set(path, set);
}
function fileChecked(f: ReviewFile): boolean {
  if (!f.hunks.length) return true; // whole-file (binary/untracked) — always in
  return (selected.get(f.path)?.size ?? 0) === f.hunks.length;
}
function filePartial(f: ReviewFile): boolean {
  const n = selected.get(f.path)?.size ?? 0;
  return n > 0 && n < f.hunks.length;
}
function toggleFile(f: ReviewFile) {
  if (!f.hunks.length) return; // nothing to toggle
  const all = (selected.get(f.path)?.size ?? 0) === f.hunks.length;
  selected.set(f.path, all ? new Set() : new Set(f.hunks.map((_, i) => i)));
}

// Colour a diff line by its leading marker.
function lineClass(line: string): string {
  if (line.startsWith('@@')) return 'text-sky-500';
  if (line.startsWith('+')) return 'text-green-500';
  if (line.startsWith('-')) return 'text-red-500';
  return 'text-muted-foreground';
}

// The selection to commit: whole file when all hunks (or no hunks) are chosen,
// else just the selected hunk strings; fully-deselected files are dropped.
const selection = computed(() =>
  files.value.flatMap((f) => {
    if (!f.hunks.length) return [{ path: f.path, hunks: [] }];
    const idx = selected.get(f.path);
    if (!idx || idx.size === 0) return [];
    if (idx.size === f.hunks.length) return [{ path: f.path, hunks: [] }];
    return [{ path: f.path, hunks: f.hunks.filter((_, i) => idx.has(i)) }];
  })
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
    <UiDialogContent class="flex max-h-[85vh] max-w-2xl flex-col">
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

      <div class="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
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
          <button
            type="button"
            class="flex w-full cursor-pointer items-center gap-2 bg-muted/40 px-2 py-1.5 text-left text-xs"
            @click="toggleFile(f)"
          >
            <NuxtIcon
              :name="
                fileChecked(f)
                  ? 'lucide:square-check'
                  : filePartial(f)
                    ? 'lucide:square-minus'
                    : 'lucide:square'
              "
              class="size-4 shrink-0"
              :class="
                fileChecked(f) || filePartial(f)
                  ? 'text-primary'
                  : 'text-muted-foreground'
              "
            />
            <span class="min-w-0 flex-1 truncate font-mono">{{ f.path }}</span>
            <span v-if="!f.hunks.length" class="text-muted-foreground">
              {{ t('changes.commitReview.wholeFile') }}
            </span>
          </button>

          <div
            v-for="(hunk, i) in f.hunks"
            :key="i"
            class="flex items-start gap-2 border-t px-2 py-1.5"
          >
            <button
              type="button"
              class="mt-0.5 flex size-4 shrink-0 cursor-pointer items-center justify-center"
              :aria-label="t('changes.select')"
              @click="toggleHunk(f.path, i)"
            >
              <NuxtIcon
                :name="
                  isHunkSelected(f.path, i)
                    ? 'lucide:square-check'
                    : 'lucide:square'
                "
                class="size-4"
                :class="
                  isHunkSelected(f.path, i)
                    ? 'text-primary'
                    : 'text-muted-foreground'
                "
              />
            </button>
            <pre
              class="min-w-0 flex-1 overflow-x-auto font-mono text-[11px] leading-relaxed"
            ><span v-for="(line, li) in hunk.split('\n')" :key="li" class="block" :class="lineClass(line)">{{ line || ' ' }}</span></pre>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-between gap-2 border-t pt-3">
        <span v-if="!hasMessage" class="text-xs text-muted-foreground">
          {{ t('changes.commitReview.needMessage') }}
        </span>
        <span v-else class="text-xs text-muted-foreground">
          {{ t('changes.commitReview.count', { n: selection.length }) }}
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
