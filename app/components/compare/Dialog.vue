<script setup lang="ts">
// Compare two arbitrary refs (branch / tag / commit): changed files + per-file
// diff, reusing the file tree and diff viewer. Mounted once in app.vue.
import type { CommitFile, DiffData } from '~/types/bindings';

const { open, presetFrom, presetTo } = useCompare();
const repo = useRepoStore();
const settings = useSettingsStore();
const layout = useLayoutStore();
const { t } = useI18n();

const from = ref('');
const to = ref('');
const files = ref<CommitFile[]>([]);
const selectedFile = ref<string | null>(null);
const diff = ref<DiffData | null>(null);
const loading = ref(false);

// Every ref the user can compare: local branches, remote branches, tags — plus
// the current from/to so a preset commit hash shows as a selectable item.
const refs = computed(() => [
  ...new Set(
    [
      from.value,
      to.value,
      ...repo.branches.map((b) => b.name),
      ...repo.remoteBranches,
      ...repo.tags
    ].filter(Boolean)
  )
]);

const effectiveMode = computed(() =>
  settings.diffMode === 'whole' ? 'unified' : settings.diffMode
);

watch(open, (isOpen) => {
  if (!isOpen) return;
  // Consume any preset (comparing two selected commits), else default.
  from.value = presetFrom.value ?? repo.currentBranch;
  to.value = presetTo.value ?? '';
  presetFrom.value = null;
  presetTo.value = null;
  files.value = [];
  selectedFile.value = null;
  diff.value = null;
});

watch([from, to], async () => {
  selectedFile.value = null;
  diff.value = null;
  files.value = [];
  if (!from.value || !to.value || from.value === to.value) return;
  loading.value = true;
  try {
    files.value = await gitClient.compareFiles({
      path: repo.repoPath,
      from: from.value,
      to: to.value
    });
    const first = files.value[0];
    if (first) await selectFile(first.path);
  } finally {
    loading.value = false;
  }
});

async function selectFile(file: string) {
  selectedFile.value = file;
  diff.value = await gitClient.compareFileDiff({
    path: repo.repoPath,
    from: from.value,
    to: to.value,
    file,
    ignoreWhitespace: layout.ignoreWhitespace,
    whole: settings.diffMode === 'whole'
  });
}

function swap() {
  [from.value, to.value] = [to.value, from.value];
}
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent
      class="flex h-[85vh] w-[90vw] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
    >
      <UiDialogHeader class="border-b px-4 py-3">
        <UiDialogTitle>{{ t('compare.title') }}</UiDialogTitle>
        <UiDialogDescription class="sr-only">
          {{ t('compare.title') }}
        </UiDialogDescription>
        <div class="mt-2 flex items-center gap-2">
          <UiSelect
            :model-value="from"
            @update:model-value="(v) => (from = v as string)"
          >
            <UiSelectTrigger class="w-56">
              <UiSelectValue :placeholder="t('compare.from')" />
            </UiSelectTrigger>
            <UiSelectContent>
              <UiSelectItem v-for="r in refs" :key="`f-${r}`" :value="r">
                {{ r }}
              </UiSelectItem>
            </UiSelectContent>
          </UiSelect>
          <UiTooltip>
            <UiTooltipTrigger as-child>
              <UiButton
                variant="ghost"
                size="icon-sm"
                icon="lucide:arrow-right-left"
                :aria-label="t('actions.swap')"
                @click="swap"
              />
            </UiTooltipTrigger>
            <UiTooltipContent>{{ t('actions.swap') }}</UiTooltipContent>
          </UiTooltip>
          <UiSelect
            :model-value="to"
            @update:model-value="(v) => (to = v as string)"
          >
            <UiSelectTrigger class="w-56">
              <UiSelectValue :placeholder="t('compare.to')" />
            </UiSelectTrigger>
            <UiSelectContent>
              <UiSelectItem v-for="r in refs" :key="`t-${r}`" :value="r">
                {{ r }}
              </UiSelectItem>
            </UiSelectContent>
          </UiSelect>
        </div>
      </UiDialogHeader>

      <div class="flex min-h-0 flex-1">
        <div class="w-64 shrink-0 overflow-auto border-r p-1">
          <p v-if="!from || !to" class="p-3 text-sm text-muted-foreground">
            {{ t('compare.pick') }}
          </p>
          <p
            v-else-if="!files.length && !loading"
            class="p-3 text-sm text-muted-foreground"
          >
            {{ t('compare.noDiff') }}
          </p>
          <FileTree
            v-else
            :files="files"
            :view="settings.fileView"
            :selected="selectedFile"
            @select="selectFile"
          />
        </div>
        <div class="min-w-0 flex-1 overflow-auto">
          <CodeDiff
            v-if="diff && diff.hunks.length"
            :hunks="diff.hunks"
            :mode="effectiveMode"
            :hide-hunk-header="settings.diffMode === 'whole'"
            :file-name="diff.fileName"
            :old-content="diff.oldContent"
            :new-content="diff.newContent"
          />
          <p v-else class="p-6 text-sm text-muted-foreground">
            {{ t('diff.noSelection') }}
          </p>
        </div>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>
