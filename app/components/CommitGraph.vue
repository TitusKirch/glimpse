<script setup lang="ts">
const repo = useRepoStore();

// All geometry comes from the pure layout module; this component only binds it.
const layout = computed(() => commitGraphLayout(repo.commits));

function refLabel(ref: string): string {
  return ref.replace('HEAD -> ', '').replace('tag: ', '');
}
function refClass(ref: string): string {
  if (ref.startsWith('HEAD'))
    return 'border-green-500/40 text-green-600 dark:text-green-400';
  if (ref.startsWith('tag:'))
    return 'border-amber-500/40 text-amber-600 dark:text-amber-400';
  if (ref.includes('/'))
    return 'border-purple-500/40 text-purple-600 dark:text-purple-400';
  return 'border-blue-500/40 text-blue-600 dark:text-blue-400';
}
</script>

<template>
  <div class="relative h-full overflow-auto">
    <div class="relative" :style="{ minHeight: layout.height + 'px' }">
      <!-- lane lines + nodes -->
      <svg
        class="absolute top-0 left-0"
        :width="layout.width"
        :height="layout.height"
        :style="{ height: layout.height + 'px' }"
      >
        <path
          v-for="(e, idx) in layout.edges"
          :key="idx"
          :d="e.d"
          :stroke="e.color"
          stroke-width="2"
          fill="none"
        />
        <circle
          v-for="n in layout.nodes"
          :key="n.hash"
          :cx="n.cx"
          :cy="n.cy"
          r="5"
          :fill="n.color"
          stroke="var(--background)"
          stroke-width="2.5"
        />
      </svg>

      <!-- commit rows -->
      <ul :style="{ paddingLeft: layout.width + 'px' }">
        <li
          v-for="c in repo.commits"
          :key="c.hash"
          class="flex cursor-pointer items-center gap-3 border-l py-2 pr-3 pl-3 transition-colors"
          :style="{ height: layout.rowHeight + 'px' }"
          :class="
            c.hash === repo.selectedHash ? 'bg-accent' : 'hover:bg-accent/40'
          "
          @click="repo.selectCommit(c.hash)"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <UiBadge
                v-for="ref in c.refs"
                :key="ref"
                variant="outline"
                class="h-[18px] gap-0 px-1.5 text-[10px] font-medium"
                :class="refClass(ref)"
              >
                {{ refLabel(ref) }}
              </UiBadge>
              <span class="truncate text-sm font-medium">{{ c.subject }}</span>
            </div>
            <div class="mt-1 truncate text-xs text-muted-foreground">
              {{ c.author }} · {{ c.date }}
            </div>
          </div>
          <code class="shrink-0 font-mono text-[11px] text-muted-foreground">{{
            c.hash.slice(0, 7)
          }}</code>
        </li>
      </ul>
    </div>
  </div>
</template>
