<script setup lang="ts">
import { useVirtualizer } from '@tanstack/vue-virtual';
import { useForm } from '@tanstack/vue-form';
import { z } from 'zod';

const repo = useRepoStore();
const { refLabel, fullRefLabel } = useBranchLabel();
const { t } = useI18n();

// All geometry comes from the pure layout module; this component only binds it.
const layout = computed(() => commitGraphLayout({ commits: repo.commits }));

// Virtualize the commit rows so large repos stay smooth; the SVG lane overlay
// is cheap and stays full-height, the heavy per-row DOM is windowed.
const scrollEl = ref<HTMLElement | null>(null);
const rowVirtualizer = useVirtualizer(
  computed(() => ({
    count: repo.commits.length,
    getScrollElement: () => scrollEl.value,
    estimateSize: () => layout.value.rowHeight,
    overscan: 14
  }))
);
const virtualRows = computed(() =>
  rowVirtualizer.value.getVirtualItems().map((vr) => ({
    start: vr.start,
    size: vr.size,
    commit: repo.commits[vr.index]!
  }))
);

// Scroll the selected commit into view (e.g. when opened from blame), so the
// highlighted row is actually visible.
watch(
  () => repo.selectedHash,
  (hash) => {
    if (!hash) return;
    const i = repo.commits.findIndex((c) => c.hash === hash);
    if (i >= 0) {
      void nextTick(() =>
        rowVirtualizer.value.scrollToIndex(i, { align: 'center' })
      );
    }
  }
);

// Client-side commit search over the loaded log. While a query is active the
// SVG graph is replaced by a flat filtered list (lane geometry can't follow an
// arbitrary subset), which is exactly what a search wants anyway. The input is a
// TanStack form field; `query` reads its current value.
const searchForm = useForm({
  defaultValues: { query: '' },
  validators: { onChange: z.object({ query: z.string() }) }
});
const query = computed(() => searchForm.state.values.query);
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return [];
  return repo.commits.filter(
    (c) =>
      c.subject.toLowerCase().includes(q) ||
      c.author.toLowerCase().includes(q) ||
      c.hash.toLowerCase().includes(q)
  );
});

// Map a ref type to a semantic badge variant (no per-call colour classes):
// HEAD = success, tag = warning, remote-tracking = outline, local = info.
function refVariant(ref: string) {
  if (ref.startsWith('HEAD')) return 'success' as const;
  if (ref.startsWith('tag:')) return 'warning' as const;
  if (ref.includes('/')) return 'outline' as const;
  return 'info' as const;
}
</script>

<template>
  <!-- loading skeleton -->
  <div v-if="repo.loading && !repo.commits.length" class="space-y-3 p-4">
    <div v-for="n in 8" :key="n" class="flex items-center gap-3">
      <UiSkeleton class="size-2.5 rounded-full" />
      <UiSkeleton class="h-4" :style="{ width: 40 + ((n * 7) % 50) + '%' }" />
    </div>
  </div>

  <!-- no history -->
  <EmptyState
    v-else-if="!repo.commits.length"
    icon="lucide:git-commit-horizontal"
    :title="t('history.empty')"
    :description="t('history.emptyHint')"
  />

  <div v-else class="flex h-full flex-col">
    <!-- search -->
    <div class="relative shrink-0 border-b p-2">
      <NuxtIcon
        name="lucide:search"
        class="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <searchForm.Field v-slot="{ field }" name="query">
        <UiInput
          :model-value="field.state.value"
          :placeholder="t('history.search')"
          class="h-8 pl-8 text-sm"
          @input="field.handleChange(($event.target as HTMLInputElement).value)"
        />
      </searchForm.Field>
    </div>

    <!-- filtered flat list -->
    <div v-if="query" class="min-h-0 flex-1 overflow-auto">
      <EmptyState
        v-if="!filtered.length"
        icon="lucide:search-x"
        :title="t('history.noMatches')"
      />
      <ul v-else>
        <CommitContextMenu v-for="c in filtered" :key="c.hash" :hash="c.hash">
          <li
            class="flex cursor-pointer items-center gap-3 border-l py-2 pr-3 pl-3 transition-colors"
            :class="
              c.hash === repo.selectedHash ? 'bg-accent' : 'hover:bg-accent/40'
            "
            @click="repo.selectCommit(c.hash)"
          >
            <div class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{{
                c.subject
              }}</span>
              <div class="mt-1 truncate text-xs text-muted-foreground">
                {{ c.author }} · {{ c.date }}
              </div>
            </div>
            <code
              class="shrink-0 font-mono text-[11px] text-muted-foreground"
              >{{ c.hash.slice(0, 7) }}</code
            >
          </li>
        </CommitContextMenu>
      </ul>
    </div>

    <!-- graph (virtualized rows + full-height SVG lane overlay) -->
    <div ref="scrollEl" v-else class="relative min-h-0 flex-1 overflow-auto">
      <div class="relative" :style="{ height: layout.height + 'px' }">
        <!-- lane lines + nodes — kept above the rows so a selected/hovered
             row's background never hides the lanes -->
        <svg
          class="pointer-events-none absolute top-0 left-0 z-10"
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
        <ul>
          <CommitContextMenu
            v-for="vr in virtualRows"
            :key="vr.commit.hash"
            :hash="vr.commit.hash"
          >
            <li
              class="absolute right-0 left-0 flex cursor-pointer items-center gap-3 border-l pr-3 pl-3 transition-colors"
              :style="{
                height: vr.size + 'px',
                transform: `translateY(${vr.start}px)`,
                paddingLeft: layout.width + 'px'
              }"
              :class="
                vr.commit.hash === repo.selectedHash
                  ? 'bg-accent'
                  : 'hover:bg-accent/40'
              "
              @click="repo.selectCommit(vr.commit.hash)"
            >
              <div class="min-w-0 flex-1 overflow-hidden">
                <div class="flex min-w-0 items-center gap-1.5">
                  <UiTooltip v-for="ref in vr.commit.refs" :key="ref">
                    <UiTooltipTrigger as-child>
                      <UiBadge :variant="refVariant(ref)" size="sm">
                        {{ refLabel(ref) }}
                      </UiBadge>
                    </UiTooltipTrigger>
                    <UiTooltipContent>{{ fullRefLabel(ref) }}</UiTooltipContent>
                  </UiTooltip>
                  <span class="truncate text-sm font-medium">{{
                    vr.commit.subject
                  }}</span>
                </div>
                <div class="mt-1 truncate text-xs text-muted-foreground">
                  {{ vr.commit.author }} · {{ vr.commit.date }}
                </div>
              </div>
              <code
                class="shrink-0 font-mono text-[11px] text-muted-foreground"
                >{{ vr.commit.hash.slice(0, 7) }}</code
              >
            </li>
          </CommitContextMenu>
        </ul>
      </div>
    </div>

    <!-- load more history -->
    <div v-if="!query && repo.hasMoreHistory" class="shrink-0 border-t p-1.5">
      <UiButton
        variant="ghost"
        size="sm"
        class="w-full gap-1.5 text-xs text-muted-foreground"
        icon="lucide:chevron-down"
        icon-size="sm"
        :pending="repo.loadingMore"
        @click="repo.loadMoreHistory()"
      >
        {{ t('history.loadMore') }}
      </UiButton>
    </div>
  </div>
</template>
