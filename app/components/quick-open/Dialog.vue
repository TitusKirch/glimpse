<script setup lang="ts">
// Global fuzzy quick-open: jump to a tracked file (opens its diff), a branch
// (switches) or a recent commit (selects). Keyboard-first; mounted once in
// app.vue. Candidates are capped and fuzzy-ranked so the list stays small.
import type { Commit } from '~/types/bindings';

const { open, hide } = useOverlay('quickOpen');
const repo = useRepoStore();
const { fuzzySearch } = useSearch();
const { t } = useI18n();

interface Item {
  type: 'file' | 'branch' | 'commit';
  label: string;
  sub?: string;
  run: () => void;
}

const files = ref<string[]>([]);
const query = ref('');
const active = ref(0);

watch(open, async (isOpen) => {
  if (!isOpen) return;
  query.value = '';
  active.value = 0;
  files.value = [];
  files.value = await gitClient.listFiles(repo.repoPath);
});

const items = computed<Item[]>(() => {
  const q = query.value.trim();
  const branchItems: Item[] = repo.branches.map((b) => ({
    type: 'branch',
    label: b.name,
    run: () => repo.checkout(b.name)
  }));
  const commitItems: Item[] = repo.commits.slice(0, 300).map((c: Commit) => ({
    type: 'commit',
    label: c.subject,
    sub: c.hash.slice(0, 7),
    run: () => repo.selectCommit(c.hash)
  }));
  if (!q) {
    return [...branchItems.slice(0, 5), ...commitItems.slice(0, 8)];
  }
  const fileItems: Item[] = files.value.map((path) => ({
    type: 'file',
    label: path,
    run: () => repo.selectFile({ file: path, staged: false })
  }));
  return fuzzySearch([...branchItems, ...fileItems, ...commitItems], q, {
    keys: ['label', 'sub']
  })
    .slice(0, 40)
    .map((h) => h.item);
});

watch(items, () => {
  active.value = 0;
});

function move(delta: number) {
  const n = items.value.length;
  if (n) active.value = (active.value + delta + n) % n;
}
function pick(item: Item) {
  hide();
  item.run();
}
function onEnter() {
  const item = items.value[active.value];
  if (item) pick(item);
}

const icon = (type: Item['type']) =>
  type === 'file'
    ? 'lucide:file'
    : type === 'branch'
      ? 'lucide:git-branch'
      : 'lucide:git-commit-horizontal';
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent class="max-w-xl gap-0 p-0">
      <UiDialogHeader class="sr-only">
        <UiDialogTitle>{{ t('quickOpen.title') }}</UiDialogTitle>
        <UiDialogDescription>{{ t('quickOpen.title') }}</UiDialogDescription>
      </UiDialogHeader>
      <input
        v-model="query"
        autofocus
        class="w-full border-b bg-transparent px-4 py-3 text-sm outline-none"
        :placeholder="t('quickOpen.placeholder')"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.enter.prevent="onEnter"
      />
      <ul class="max-h-80 overflow-auto p-1">
        <li
          v-for="(item, i) in items"
          :key="`${item.type}:${item.label}:${i}`"
          class="flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm"
          :class="i === active ? 'bg-accent' : 'hover:bg-accent/50'"
          @mousemove="active = i"
          @click="pick(item)"
        >
          <NuxtIcon
            :name="icon(item.type)"
            class="size-4 shrink-0 text-muted-foreground"
          />
          <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
          <code
            v-if="item.sub"
            class="shrink-0 font-mono text-[11px] text-muted-foreground"
            >{{ item.sub }}</code
          >
        </li>
        <li
          v-if="!items.length"
          class="px-3 py-6 text-center text-sm text-muted-foreground"
        >
          {{ t('quickOpen.empty') }}
        </li>
      </ul>
    </UiDialogContent>
  </UiDialog>
</template>
