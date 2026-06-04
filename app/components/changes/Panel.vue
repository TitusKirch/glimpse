<script setup lang="ts">
import { useForm } from '@tanstack/vue-form';
import { z } from 'zod';
import type { StatusEntry } from '@/stores/repo';

const repo = useRepoStore();
const settings = useSettingsStore();
const mergeEditor = useMergeEditor();
const { t } = useI18n();

const modLabel = navigator.platform.toLowerCase().includes('mac')
  ? '⌘'
  : 'Ctrl';

// Single, consistent letter per file: A = new/untracked, M = modified,
// D = deleted, R = renamed. (git's literal "?"/"U" codes are not user-facing.)
function letter({
  entry,
  staged
}: {
  entry: StatusEntry;
  staged: boolean;
}): string {
  const c = (staged ? entry.x : entry.y).trim();
  if (!c || c === '?') return 'A';
  return c;
}

// FileTree items carry the display letter plus the original entry fields.
const stagedItems = computed(() =>
  repo.stagedFiles.map((f) => ({
    ...f,
    status: letter({ entry: f, staged: true })
  }))
);
const unstagedItems = computed(() =>
  repo.unstagedFiles.map((f) => ({
    ...f,
    status: letter({ entry: f, staged: false })
  }))
);
// Conflicts carry a "U" (unmerged) letter; the section header already flags them.
const conflictItems = computed(() =>
  repo.conflictedFiles.map((f) => ({ ...f, status: 'U' }))
);

// Subject is the first line; git convention favours <= 50 chars (warn), and
// hard-wraps the eye at 72 (over). Drives the live counter colour.
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

const canCommit = computed(
  () =>
    !!repo.commitMessage.trim() && (repo.amend || repo.stagedFiles.length > 0)
);

// --- Conventional Commit composer (opt-in) ---------------------------------
// Assembles a `type(scope)!: ` prefix on the subject line. Re-applying is
// idempotent (it strips any existing prefix first), so changing a control never
// stacks prefixes and the user's typed subject is preserved.
const CC_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert'
];
const ccType = ref('feat');
const ccScope = ref('');
const ccBreaking = ref(false);
const PREFIX_RE = /^[a-z]+(\([^)]*\))?!?:\s*/i;

// The composer's on/off lives in git config (glimpse.conventionalCommits):
// effective for the active repo (local override, else global). The braces button
// writes the scope in effect — local when this repo overrides globals.
const ccEnabled = ref(false);

async function loadConventional() {
  if (!isTauri() || !repo.active) return;
  ccEnabled.value =
    (await gitClient.getConfig({
      path: repo.active.path,
      key: 'glimpse.conventionalCommits',
      scope: ''
    })) === 'true';
}
onMounted(loadConventional);
watch(() => repo.active?.path, loadConventional);

async function toggleConventional() {
  ccEnabled.value = !ccEnabled.value;
  if (!isTauri() || !repo.active) return;
  const path = repo.active.path;
  const overriding =
    (await gitClient.getConfig({
      path,
      key: 'glimpse.override',
      scope: 'local'
    })) === 'true';
  await gitClient.setConfig({
    path,
    key: 'glimpse.conventionalCommits',
    value: ccEnabled.value ? 'true' : 'false',
    global: !overriding
  });
}

function applyConventional() {
  const lines = repo.commitMessage.split('\n');
  const subject = (lines[0] ?? '').replace(PREFIX_RE, '');
  const scope = ccScope.value.trim();
  lines[0] =
    `${ccType.value}${scope ? `(${scope})` : ''}${ccBreaking.value ? '!' : ''}: ` +
    subject;
  repo.commitMessage = lines.join('\n');
}

watch([ccType, ccScope, ccBreaking, ccEnabled], () => {
  if (ccEnabled.value) applyConventional();
});

// Append a `Closes #` footer for the user to complete.
function insertCloses() {
  repo.commitMessage = `${repo.commitMessage.replace(/\s*$/, '')}\n\nCloses #`;
}

// Commit message form (TanStack Form + Zod). The store still owns
// repo.commitMessage — the commit action, the amend prefill and the Cmd/Ctrl+↵
// shortcut all read it — so the field two-way syncs with it.
const commitForm = useForm({
  defaultValues: { message: repo.commitMessage },
  validators: { onChange: z.object({ message: z.string().trim().min(1) }) },
  onSubmit: () => repo.commit()
});
watch(
  () => commitForm.state.values.message,
  (m) => {
    if (repo.commitMessage !== m) repo.commitMessage = m;
  }
);
watch(
  () => repo.commitMessage,
  (m) => {
    if (commitForm.state.values.message !== m)
      commitForm.setFieldValue('message', m);
  }
);

// Auto-grow the commit box with its content: reset to 'auto' then snap to the
// scroll height. A CSS min/max-height keeps it between ~3 rows and a cap (then
// it scrolls internally), so a long body never swallows the file list.
const commitBox = ref<HTMLTextAreaElement | null>(null);
function autoResize() {
  const el = commitBox.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}
// Re-fit on programmatic changes too (amend prefill, post-commit clear).
watch(
  () => repo.commitMessage,
  () => nextTick(autoResize)
);
onMounted(autoResize);
</script>

<template>
  <div class="flex h-full flex-col text-sm">
    <FileViewToggle class="border-b" />

    <!-- rebase paused (e.g. on a conflict): continue / skip / abort -->
    <div
      v-if="repo.rebaseInProgress"
      class="flex flex-wrap items-center gap-2 border-b bg-warning/10 px-3 py-2 text-xs"
    >
      <NuxtIcon name="lucide:git-graph" class="size-4 shrink-0 text-warning" />
      <span class="min-w-0 flex-1">{{ t('rebase.inProgress') }}</span>
      <UiButton size="sm" variant="outline" @click="repo.rebaseContinue()">
        {{ t('rebase.continue') }}
      </UiButton>
      <UiButton size="sm" variant="ghost" @click="repo.rebaseSkip()">
        {{ t('rebase.skip') }}
      </UiButton>
      <UiButton
        size="sm"
        variant="ghost"
        class="text-destructive hover:text-destructive"
        @click="repo.rebaseAbort()"
      >
        {{ t('rebase.abort') }}
      </UiButton>
    </div>

    <!-- bisect in progress: test the checked-out commit, then mark it -->
    <div
      v-if="repo.bisectInProgress"
      class="flex flex-wrap items-center gap-2 border-b bg-primary/10 px-3 py-2 text-xs"
    >
      <NuxtIcon name="lucide:bug" class="size-4 shrink-0 text-primary" />
      <span class="min-w-0 flex-1">{{ t('bisect.testing') }}</span>
      <UiButton size="sm" variant="outline" @click="repo.bisectMark('good')">
        {{ t('bisect.markGood') }}
      </UiButton>
      <UiButton size="sm" variant="outline" @click="repo.bisectMark('bad')">
        {{ t('bisect.markBad') }}
      </UiButton>
      <UiButton size="sm" variant="ghost" @click="repo.bisectMark('skip')">
        {{ t('bisect.skip') }}
      </UiButton>
      <UiButton
        size="sm"
        variant="ghost"
        class="text-destructive hover:text-destructive"
        @click="repo.bisectReset()"
      >
        {{ t('bisect.reset') }}
      </UiButton>
    </div>

    <div class="min-h-0 flex-1 overflow-auto">
      <!-- loading skeleton -->
      <div v-if="repo.loading && !repo.status.length" class="space-y-2 p-3">
        <UiSkeleton v-for="n in 6" :key="n" class="h-6 w-full" />
      </div>

      <!-- merge conflicts -->
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

      <!-- staged -->
      <section v-if="repo.stagedFiles.length" class="px-1">
        <h3
          class="sticky top-0 z-10 bg-background px-2 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {{ t('changes.staged') }} ({{ repo.stagedFiles.length }})
        </h3>
        <FileTree
          :files="stagedItems"
          :view="settings.fileView"
          :selected="repo.selectedFileStaged ? repo.selectedFile : null"
          @select="(p) => repo.selectFile({ file: p, staged: true })"
        >
          <template #actions="{ file }">
            <UiTooltip>
              <UiTooltipTrigger as-child>
                <UiButton
                  variant="ghost"
                  size="icon"
                  class="size-5 opacity-0 group-hover:opacity-100"
                  icon="lucide:minus"
                  icon-size="sm"
                  @click.stop="repo.unstage(file.path)"
                />
              </UiTooltipTrigger>
              <UiTooltipContent>{{ t('changes.unstage') }}</UiTooltipContent>
            </UiTooltip>
          </template>
        </FileTree>
      </section>

      <!-- unstaged / untracked -->
      <section v-if="repo.unstagedFiles.length" class="group/sec px-1">
        <h3
          class="sticky top-0 z-10 flex items-center gap-2 bg-background px-2 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          <span
            >{{ t('changes.unstaged') }} ({{ repo.unstagedFiles.length }})</span
          >
          <UiTooltip>
            <UiTooltipTrigger as-child>
              <UiButton
                variant="ghost"
                size="icon"
                class="ml-auto size-5 opacity-0 group-hover/sec:opacity-100"
                icon="lucide:undo-2"
                icon-size="sm"
                @click="repo.discardAll()"
              />
            </UiTooltipTrigger>
            <UiTooltipContent>{{ t('changes.discardAll') }}</UiTooltipContent>
          </UiTooltip>
        </h3>
        <FileTree
          :files="unstagedItems"
          :view="settings.fileView"
          :selected="!repo.selectedFileStaged ? repo.selectedFile : null"
          @select="(p) => repo.selectFile({ file: p, staged: false })"
        >
          <template #actions="{ file }">
            <UiTooltip>
              <UiTooltipTrigger as-child>
                <UiButton
                  variant="ghost"
                  size="icon"
                  class="size-5 opacity-0 group-hover:opacity-100"
                  icon="lucide:undo-2"
                  icon-size="sm"
                  @click.stop="
                    repo.discard({ file: file.path, untracked: file.untracked })
                  "
                />
              </UiTooltipTrigger>
              <UiTooltipContent>{{ t('changes.discard') }}</UiTooltipContent>
            </UiTooltip>
            <UiTooltip>
              <UiTooltipTrigger as-child>
                <UiButton
                  variant="ghost"
                  size="icon"
                  class="size-5 opacity-0 group-hover:opacity-100"
                  icon="lucide:plus"
                  icon-size="sm"
                  @click.stop="repo.stage(file.path)"
                />
              </UiTooltipTrigger>
              <UiTooltipContent>{{ t('changes.stage') }}</UiTooltipContent>
            </UiTooltip>
          </template>
        </FileTree>
      </section>

      <EmptyState
        v-if="!repo.loading && !repo.status.length"
        icon="lucide:check"
        :title="t('changes.clean')"
        :description="t('changes.cleanHint')"
      />
    </div>

    <!-- commit box -->
    <form class="border-t p-2" @submit.prevent="commitForm.handleSubmit">
      <div v-if="ccEnabled" class="mb-2 flex flex-wrap items-center gap-1.5">
        <UiDropdownMenu>
          <UiDropdownMenuTrigger as-child>
            <UiButton
              type="button"
              variant="outline"
              size="sm"
              class="h-7 gap-1 px-2 text-xs"
            >
              {{ ccType }}
              <NuxtIcon name="lucide:chevron-down" class="size-3 opacity-60" />
            </UiButton>
          </UiDropdownMenuTrigger>
          <UiDropdownMenuContent align="start">
            <UiDropdownMenuItem
              v-for="ty in CC_TYPES"
              :key="ty"
              @click="ccType = ty"
            >
              {{ ty }}
            </UiDropdownMenuItem>
          </UiDropdownMenuContent>
        </UiDropdownMenu>
        <input
          v-model="ccScope"
          :placeholder="t('changes.conventional.scope')"
          class="h-7 w-24 rounded-md border bg-transparent px-2 text-xs outline-none"
        />
        <label class="flex items-center gap-1 text-xs text-muted-foreground">
          <UiSwitch
            :model-value="ccBreaking"
            @update:model-value="(v) => (ccBreaking = v as boolean)"
          />
          {{ t('changes.conventional.breaking') }}
        </label>
        <UiButton
          type="button"
          size="sm"
          variant="ghost"
          class="ml-auto h-7 text-xs"
          @click="insertCloses"
        >
          {{ t('changes.conventional.closes') }}
        </UiButton>
      </div>
      <div class="relative">
        <commitForm.Field v-slot="{ field }" name="message">
          <textarea
            ref="commitBox"
            :value="field.state.value"
            :placeholder="t('changes.commit.placeholder')"
            class="max-h-48 min-h-[4.5rem] w-full resize-none overflow-y-auto rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            @input="
              field.handleChange(($event.target as HTMLTextAreaElement).value);
              autoResize();
            "
          />
        </commitForm.Field>
        <span
          class="pointer-events-none absolute right-2 bottom-1.5 font-mono text-[10px]"
          :class="subjectClass"
          >{{ subjectLen }}</span
        >
      </div>

      <div class="mt-2 flex items-center justify-between gap-2">
        <div class="flex items-center gap-3">
          <label class="flex cursor-pointer items-center gap-1.5 text-xs">
            <UiSwitch
              :model-value="repo.amend"
              @update:model-value="repo.setAmend($event)"
            />
            <span class="text-muted-foreground">{{ t('changes.amend') }}</span>
          </label>
          <button
            type="button"
            class="text-muted-foreground transition-colors hover:text-foreground"
            :class="ccEnabled && 'text-primary'"
            :title="t('changes.conventional.toggle')"
            @click="toggleConventional()"
          >
            <NuxtIcon name="lucide:braces" class="size-4" />
          </button>
        </div>
        <UiKbd>{{ modLabel }}+↵</UiKbd>
      </div>

      <UiButton
        class="mt-2 w-full"
        size="sm"
        type="submit"
        :disabled="!canCommit"
      >
        {{ repo.amend ? t('changes.amendCommit') : t('changes.commit.label') }}
        <span v-if="!repo.amend && repo.stagedFiles.length"
          >({{ repo.stagedFiles.length }})</span
        >
      </UiButton>
    </form>
  </div>
</template>
