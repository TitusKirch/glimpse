<script setup lang="ts">
// Per-line blame for the selected working file. The commit gutter (hash +
// author + date) is shown only where it changes, so consecutive lines from one
// commit read as a block.
import type { BlameLine } from '@/stores/repo';

const props = defineProps<{ file: string }>();
const repo = useRepoStore();
const layout = useLayoutStore();
const { t } = useI18n();
const copyText = useCopy();

// Open the blamed commit in the history/diff view. blame hashes are
// abbreviated, so resolve to the loaded commit's full hash where possible —
// the graph highlights by exact hash.
function viewCommit(hash: string) {
  const full = repo.commits.find((c) => c.hash.startsWith(hash))?.hash ?? hash;
  layout.setLeftTab('history');
  void repo.selectCommit(full);
}

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
            <UiHoverCard v-if="isNewBlock(i)" :open-delay="150">
              <UiHoverCardTrigger
                class="flex w-fit max-w-full cursor-pointer items-baseline gap-1.5 truncate decoration-dotted hover:underline"
              >
                <span class="font-semibold text-foreground">{{ l.hash }}</span>
                <span class="truncate text-muted-foreground">{{
                  l.author
                }}</span>
              </UiHoverCardTrigger>
              <UiHoverCardContent class="w-72 space-y-2 text-xs" side="right">
                <div class="flex items-center gap-2 font-medium">
                  <NuxtIcon
                    name="lucide:user"
                    class="size-3.5 text-muted-foreground"
                  />
                  <span>{{ l.author }}</span>
                </div>
                <div class="flex items-center gap-2 text-muted-foreground">
                  <NuxtIcon name="lucide:calendar" class="size-3.5" />
                  <span>{{ l.date }}</span>
                </div>
                <div class="flex items-center gap-2 text-muted-foreground">
                  <NuxtIcon
                    name="lucide:git-commit-horizontal"
                    class="size-3.5"
                  />
                  <code class="font-mono text-foreground">{{ l.hash }}</code>
                  <UiButton
                    variant="ghost"
                    size="icon"
                    class="ml-auto size-6"
                    :aria-label="t('commit.copyHash')"
                    @click="copyText(l.hash)"
                  >
                    <NuxtIcon name="lucide:copy" class="size-3.5" />
                  </UiButton>
                </div>
                <UiSeparator />
                <UiButton
                  variant="outline"
                  size="sm"
                  class="w-full"
                  @click="viewCommit(l.hash)"
                >
                  <NuxtIcon name="lucide:eye" class="size-3.5" />
                  {{ t('diff.blameViewCommit') }}
                </UiButton>
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
