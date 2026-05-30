<script setup lang="ts">
const repo = useRepoStore();

const ROW_H = 60;
const LANE_W = 18;
const ORIGIN_X = 18;
const LANE_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#a855f7'];

const laneX = (lane: number) => ORIGIN_X + lane * LANE_W;
const nodeY = (i: number) => ROW_H / 2 + i * ROW_H;
const laneColor = (lane: number) => LANE_COLORS[lane % LANE_COLORS.length];

const indexByHash = computed(() => {
  const m = new Map<string, number>();
  repo.commits.forEach((c, i) => m.set(c.hash, i));
  return m;
});

const maxLane = computed(() =>
  repo.commits.reduce((max, c) => Math.max(max, c.lane), 0)
);
const graphWidth = computed(() => laneX(maxLane.value) + ORIGIN_X);
const svgHeight = computed(() => repo.commits.length * ROW_H);

interface Edge {
  d: string;
  color: string;
}

const edges = computed<Edge[]>(() => {
  const out: Edge[] = [];
  repo.commits.forEach((c, i) => {
    for (const parent of c.parents) {
      const j = indexByHash.value.get(parent);
      if (j === undefined) continue;
      const x1 = laneX(c.lane);
      const y1 = nodeY(i);
      const x2 = laneX(repo.commits[j]!.lane);
      const y2 = nodeY(j);
      const midY = (y1 + y2) / 2;
      out.push({
        d: `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`,
        color: laneColor(Math.max(c.lane, repo.commits[j]!.lane))
      });
    }
  });
  return out;
});

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
    <div class="relative" :style="{ minHeight: svgHeight + 'px' }">
      <!-- lane lines + nodes -->
      <svg
        class="absolute top-0 left-0"
        :width="graphWidth"
        :height="svgHeight"
        :style="{ height: svgHeight + 'px' }"
      >
        <path
          v-for="(e, idx) in edges"
          :key="idx"
          :d="e.d"
          :stroke="e.color"
          stroke-width="2"
          fill="none"
        />
        <circle
          v-for="(c, i) in repo.commits"
          :key="c.hash"
          :cx="laneX(c.lane)"
          :cy="nodeY(i)"
          r="5"
          :fill="laneColor(c.lane)"
          stroke="var(--background)"
          stroke-width="2.5"
        />
      </svg>

      <!-- commit rows -->
      <ul :style="{ paddingLeft: graphWidth + 'px' }">
        <li
          v-for="c in repo.commits"
          :key="c.hash"
          class="flex cursor-pointer items-center gap-3 border-l py-2 pr-3 pl-3 transition-colors"
          :style="{ height: ROW_H + 'px' }"
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
