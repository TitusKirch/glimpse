<script setup lang="ts">
// Three-way merge editor: parse a conflicted file into regions and resolve each
// (ours / theirs / both / base) with the chosen side highlighted, then save the
// assembled result and stage the file. Mounted once in app.vue.
import type { MergeSegment } from '~/types/conflict';

const { open, file, hide } = useMergeEditor();
const repo = useRepoStore();
const { t } = useI18n();

type Choice = 'ours' | 'theirs' | 'both' | 'base';
const segments = ref<MergeSegment[]>([]);
const choices = ref<Record<number, Choice>>({});
const loading = ref(false);

watch(open, async (isOpen) => {
  if (!isOpen || !file.value) return;
  loading.value = true;
  segments.value = [];
  choices.value = {};
  try {
    const content = await gitClient.conflictContent({
      path: repo.repoPath,
      file: file.value
    });
    segments.value = parseConflicts(content);
    segments.value.forEach((s, i) => {
      if (s.type === 'conflict') choices.value[i] = 'ours';
    });
  } finally {
    loading.value = false;
  }
});

const conflictCount = computed(
  () => segments.value.filter((s) => s.type === 'conflict').length
);

function options(seg: MergeSegment): Choice[] {
  return seg.type === 'conflict' && seg.base
    ? ['ours', 'base', 'theirs', 'both']
    : ['ours', 'theirs', 'both'];
}

function resolved(seg: MergeSegment, i: number): string {
  if (seg.type === 'text') return seg.text;
  const c = choices.value[i] ?? 'ours';
  if (c === 'theirs') return seg.theirs;
  if (c === 'both') return `${seg.ours}\n${seg.theirs}`;
  if (c === 'base') return seg.base ?? '';
  return seg.ours;
}

// Live assembled result that gets written on save.
const result = computed(() =>
  segments.value.map((s, i) => resolved(s, i)).join('\n')
);

async function save() {
  if (!file.value) return;
  hide();
  await repo.saveResolution({ file: file.value, content: result.value });
}
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent
      class="flex h-[85vh] w-[90vw] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
    >
      <UiDialogHeader class="border-b px-4 py-3">
        <UiDialogTitle class="truncate">
          {{ t('merge.title') }} · <code class="text-sm">{{ file }}</code>
        </UiDialogTitle>
        <UiDialogDescription class="sr-only">
          {{ t('merge.title') }}
        </UiDialogDescription>
      </UiDialogHeader>

      <div v-if="loading" class="space-y-2 p-4">
        <UiSkeleton v-for="n in 8" :key="n" class="h-6" />
      </div>
      <div v-else class="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs">
        <template v-for="(seg, i) in segments" :key="i">
          <pre
            v-if="seg.type === 'text'"
            class="px-2 whitespace-pre-wrap text-muted-foreground"
            >{{ seg.text }}</pre>
          <div v-else class="my-2 overflow-hidden rounded-md border">
            <div
              class="flex flex-wrap items-center gap-1 border-b bg-muted/40 px-2 py-1"
            >
              <span
                class="mr-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase"
                >{{ t('merge.region') }}</span
              >
              <button
                v-for="opt in options(seg)"
                :key="opt"
                type="button"
                class="rounded px-2 py-0.5 text-[11px]"
                :class="
                  (choices[i] ?? 'ours') === opt
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-accent'
                "
                @click="choices[i] = opt"
              >
                {{ t(`merge.${opt}`) }}
              </button>
            </div>
            <div class="grid" :class="seg.base ? 'grid-cols-3' : 'grid-cols-2'">
              <pre
                class="border-r px-2 py-1 whitespace-pre-wrap"
                :class="
                  ['ours', 'both'].includes(choices[i] ?? 'ours')
                    ? 'bg-green-500/10'
                    : ''
                "
                >{{ seg.ours }}</pre>
              <pre
                v-if="seg.base"
                class="border-r px-2 py-1 whitespace-pre-wrap text-muted-foreground"
                :class="choices[i] === 'base' ? 'bg-blue-500/10' : ''"
                >{{ seg.base }}</pre>
              <pre
                class="px-2 py-1 whitespace-pre-wrap"
                :class="
                  ['theirs', 'both'].includes(choices[i] ?? 'ours')
                    ? 'bg-blue-500/10'
                    : ''
                "
                >{{ seg.theirs }}</pre>
            </div>
          </div>
        </template>
      </div>

      <UiDialogFooter class="border-t px-4 py-3">
        <span class="mr-auto self-center text-xs text-muted-foreground">
          {{ t('merge.regions', { n: conflictCount }) }}
        </span>
        <UiButton variant="ghost" icon="lucide:x" @click="hide">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton icon="lucide:check" @click="save">
          {{ t('merge.save') }}
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>
