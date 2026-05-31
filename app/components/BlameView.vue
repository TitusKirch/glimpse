<script setup lang="ts">
// Per-line blame for the selected working file. The commit gutter (hash +
// author + date) is shown only where it changes, so consecutive lines from one
// commit read as a block.
import type { BlameLine } from '@/stores/repo';

const props = defineProps<{ file: string }>();
const repo = useRepoStore();

const lines = ref<BlameLine[]>([]);
const loading = ref(false);

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
  <div class="h-full overflow-auto font-mono text-xs leading-[1.6]">
    <div v-if="loading" class="space-y-2 p-4">
      <UiSkeleton
        v-for="n in 14"
        :key="n"
        class="h-4"
        :style="{ width: 30 + ((n * 11) % 60) + '%' }"
      />
    </div>
    <table v-else class="w-max min-w-full border-collapse">
      <tbody>
        <tr v-for="(l, i) in lines" :key="i" class="hover:bg-accent/30">
          <td
            class="sticky left-0 max-w-52 min-w-52 truncate border-r bg-background px-2 align-top text-muted-foreground select-none"
            :title="`${l.hash} · ${l.author} · ${l.date}`"
          >
            <template v-if="isNewBlock(i)">
              <span class="font-medium text-foreground">{{ l.hash }}</span>
              {{ l.author }} · {{ l.date }}
            </template>
          </td>
          <td class="w-10 px-2 text-right text-muted-foreground select-none">
            {{ l.line }}
          </td>
          <td class="px-2 whitespace-pre">{{ l.content }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
