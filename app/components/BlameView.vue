<script setup lang="ts">
// Per-line blame for the selected working file. The commit gutter (hash +
// author + date) is shown only where it changes, so consecutive lines from one
// commit read as a block.
import type { BlameLine } from '@/stores/repo';

const props = defineProps<{ file: string }>();
const repo = useRepoStore();
const { t } = useI18n();

const lines = ref<BlameLine[]>([]);
const loading = ref(false);
const lang = computed(() => diffLang(props.file));

async function load() {
  loading.value = true;
  lines.value = [];
  try {
    lines.value = await gitClient.blame(repo.repoPath, props.file);
  } finally {
    loading.value = false;
  }
}
watch(() => props.file, load, { immediate: true });

function isNewBlock(i: number): boolean {
  return i === 0 || lines.value[i]!.hash !== lines.value[i - 1]!.hash;
}
</script>

<template>
  <div class="hljs-diff h-full overflow-auto font-mono text-xs leading-[1.6]">
    <div v-if="loading" class="space-y-2 p-4">
      <UiSkeleton
        v-for="n in 14"
        :key="n"
        class="h-4"
        :style="{ width: 30 + ((n * 11) % 60) + '%' }"
      />
    </div>
    <EmptyState
      v-else-if="!lines.length"
      icon="lucide:file-question"
      :title="t('diff.blameEmpty')"
      :description="t('diff.blameEmptyHint')"
    />
    <table v-else class="w-max min-w-full border-collapse">
      <tbody>
        <tr v-for="(l, i) in lines" :key="i" class="hover:bg-accent/30">
          <td
            class="sticky left-0 max-w-48 min-w-48 truncate border-r bg-background px-2 align-top text-muted-foreground select-none"
          >
            <UiHoverCard v-if="isNewBlock(i)" :open-delay="200">
              <UiHoverCardTrigger
                class="flex w-full cursor-default items-baseline gap-1.5 truncate"
              >
                <span class="font-semibold text-foreground">{{ l.hash }}</span>
                <span class="truncate text-muted-foreground">{{
                  l.author
                }}</span>
              </UiHoverCardTrigger>
              <UiHoverCardContent class="w-auto text-xs" side="right">
                <div class="flex items-center gap-2">
                  <NuxtIcon name="lucide:user" class="size-3.5" />
                  <span class="font-medium">{{ l.author }}</span>
                </div>
                <div class="mt-1 flex items-center gap-2 text-muted-foreground">
                  <NuxtIcon name="lucide:calendar" class="size-3.5" />
                  <span>{{ l.date }}</span>
                  <code class="ml-1 font-mono">{{ l.hash }}</code>
                </div>
              </UiHoverCardContent>
            </UiHoverCard>
          </td>
          <td class="w-10 px-2 text-right text-muted-foreground select-none">
            {{ l.line }}
          </td>
          <td
            class="px-2 whitespace-pre"
            v-html="highlightLine(l.content, lang)"
          />
        </tr>
      </tbody>
    </table>
  </div>
</template>
