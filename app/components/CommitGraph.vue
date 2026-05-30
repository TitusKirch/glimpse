<script setup lang="ts">
const repo = useRepoStore();

const ROW_H = 50;
const LANE_W = 18;
const ORIGIN_X = 16;
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
          stroke-width="2"
        />
      </svg>

      <!-- commit rows -->
      <ul :style="{ paddingLeft: graphWidth + 'px' }">
        <li
          v-for="c in repo.commits"
          :key="c.hash"
          class="flex cursor-pointer items-center gap-2 border-l pr-4 transition-colors"
          :style="{ height: ROW_H + 'px' }"
          :class="
            c.hash === repo.selectedHash ? 'bg-accent/70' : 'hover:bg-accent/40'
          "
          @click="repo.selectCommit(c.hash)"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <UiBadge
                v-for="ref in c.refs"
                :key="ref"
                variant="outline"
                class="text-[10px] text-blue-500"
              >
                {{ ref }}
              </UiBadge>
              <span class="truncate text-sm">{{ c.subject }}</span>
            </div>
            <div class="text-xs text-muted-foreground">
              <code>{{ c.hash }}</code> · {{ c.author }} · {{ c.date }}
            </div>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
