<script setup lang="ts">
// Interactive-rebase plan builder. Lists the start commit and its descendants up
// to HEAD; each can be reworded / squashed / fixed up / dropped and reordered,
// then the plan is run. A conflict pauses into the existing rebase banner.
// Mounted once in app.vue.
import type { Commit } from '~/types/bindings';

const { open, start, hide } = useRebasePlan();
const repo = useRepoStore();
const { t } = useI18n();

type Action = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop';
interface Row {
  commit: Commit;
  action: Action;
  message: string;
}

const ACTIONS: Action[] = ['pick', 'reword', 'squash', 'fixup', 'drop'];

const rows = ref<Row[]>([]);
const loading = ref(false);

// Rewriting commits that are already on a remote needs a force-push afterwards.
const published = computed(
  () =>
    repo.branches.find((b) => b.name === repo.currentBranch)?.published ?? false
);

watch(open, async (isOpen) => {
  if (!isOpen || !start.value) return;
  loading.value = true;
  rows.value = [];
  try {
    const commits = await repo.rebaseCommits(start.value);
    rows.value = commits.map((commit) => ({
      commit,
      action: 'pick',
      message: commit.subject
    }));
  } finally {
    loading.value = false;
  }
});

function move(i: number, delta: number) {
  const j = i + delta;
  if (j < 0 || j >= rows.value.length) return;
  const next = rows.value.slice();
  const [moved] = next.splice(i, 1);
  next.splice(j, 0, moved!);
  rows.value = next;
}

// squash/fixup fold into the previous kept commit, so the first row can't use
// them.
const actionsFor = (i: number): Action[] =>
  i === 0 ? ACTIONS.filter((a) => a !== 'squash' && a !== 'fixup') : ACTIONS;

const valid = computed(() => {
  const first = rows.value[0];
  if (!first || first.action === 'squash' || first.action === 'fixup')
    return false;
  return rows.value.some((r) => r.action !== 'drop');
});

async function run() {
  if (!valid.value) return;
  const base = rows.value[0]!.commit.parents[0] ?? '';
  const steps = rows.value.map((r) => ({
    action: r.action,
    hash: r.commit.hash,
    message:
      (r.action === 'reword' || r.action === 'squash') && r.message.trim()
        ? r.message
        : null
  }));
  hide();
  await repo.interactiveRebase({ base, steps });
}
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent class="max-w-2xl">
      <UiDialogHeader>
        <UiDialogTitle>{{ t('rebasePlan.title') }}</UiDialogTitle>
        <UiDialogDescription>
          {{ t('rebasePlan.description') }}
        </UiDialogDescription>
      </UiDialogHeader>

      <div
        v-if="published"
        class="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
      >
        <NuxtIcon name="lucide:triangle-alert" class="mt-0.5 size-4 shrink-0" />
        <span>{{ t('rebasePlan.publishedWarning') }}</span>
      </div>

      <div v-if="loading" class="space-y-2 py-2">
        <UiSkeleton v-for="n in 5" :key="n" class="h-10" />
      </div>
      <EmptyState
        v-else-if="!rows.length"
        icon="lucide:list-ordered"
        :title="t('rebasePlan.empty')"
      />
      <ul v-else class="max-h-[55vh] space-y-1 overflow-auto">
        <li
          v-for="(row, i) in rows"
          :key="row.commit.hash"
          class="flex flex-col gap-1 rounded-md border px-2 py-1.5"
          :class="row.action === 'drop' && 'opacity-60'"
        >
          <div class="flex items-center gap-2">
            <div class="flex shrink-0 flex-col">
              <UiButton
                variant="ghost"
                size="icon-sm"
                icon="lucide:chevron-up"
                :aria-label="t('rebasePlan.moveUp')"
                :disabled="i === 0"
                @click="move(i, -1)"
              />
              <UiButton
                variant="ghost"
                size="icon-sm"
                icon="lucide:chevron-down"
                :aria-label="t('rebasePlan.moveDown')"
                :disabled="i === rows.length - 1"
                @click="move(i, 1)"
              />
            </div>
            <UiSelect
              :model-value="row.action"
              @update:model-value="(v) => (row.action = v as Action)"
            >
              <UiSelectTrigger class="w-28 shrink-0">
                <UiSelectValue />
              </UiSelectTrigger>
              <UiSelectContent>
                <UiSelectItem v-for="a in actionsFor(i)" :key="a" :value="a">
                  {{ t(`rebasePlan.action.${a}`) }}
                </UiSelectItem>
              </UiSelectContent>
            </UiSelect>
            <code
              class="shrink-0 font-mono text-[11px] text-muted-foreground"
              >{{ row.commit.hash.slice(0, 7) }}</code
            >
            <span
              class="min-w-0 flex-1 truncate text-sm"
              :class="row.action === 'drop' && 'line-through'"
              >{{ row.commit.subject }}</span
            >
          </div>
          <UiInput
            v-if="row.action === 'reword' || row.action === 'squash'"
            v-model="row.message"
            class="h-8 text-sm"
            :placeholder="t('rebasePlan.messagePlaceholder')"
          />
        </li>
      </ul>

      <UiDialogFooter>
        <UiButton variant="ghost" icon="lucide:x" @click="hide">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton icon="lucide:list-ordered" :disabled="!valid" @click="run">
          {{ t('rebasePlan.run') }}
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>
