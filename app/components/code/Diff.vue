<script setup lang="ts">
// Lightweight unified/split diff renderer. The hunk → row-model projection (and
// all highlighting / word-diffing) lives in the pure parseDiff module; this
// component binds the result and virtualizes the rows.
//
// Rows are virtualized (TanStack Virtual) so a 10k-line file only mounts the
// handful of rows on screen. We use the *padding* technique — real rows stay in
// normal flow between a top/bottom spacer — rather than absolute positioning,
// because absolute rows can't push a `w-max` track wider than the viewport and
// would kill horizontal scrolling of long lines.
import { useVirtualizer } from '@tanstack/vue-virtual';
import type { UnifiedRow } from '~/types/diff';

const props = defineProps<{
  hunks: string[];
  mode: 'split' | 'unified';
  fileName: string;
  // When set, each hunk gets a stage/unstage button emitting `stageHunk`.
  hunkAction?: 'stage' | 'unstage' | null;
  // Whole-file view: drop the `@@` hunk-header rows (the diff was fetched with
  // full context, so there's a single header — hiding it reads as "the file").
  hideHunkHeader?: boolean;
  // Full file contents (from DiffData). When present, lines are highlighted from
  // the whole file (keeping cross-line context, e.g. a Vue SFC's script/style)
  // and looked up by line number, instead of highlighted in isolation.
  oldContent?: string;
  newContent?: string;
  // Soft-wrap long lines (unified view); rows then become variable-height and
  // are measured by the virtualizer instead of pinned to a fixed box.
  wrap?: boolean;
}>();

const emit = defineEmits<{
  stageHunk: [hunk: string];
  discardHunk: [hunk: string];
  stageLines: [{ hunk: string; lines: number[] }];
}>();

const { t } = useI18n();

// A collapsed "… N unchanged lines" marker injected between context runs.
interface ExpanderRow {
  type: 'expander';
  key: string;
  count: number;
}
type DisplayRow = UnifiedRow | ExpanderRow;

// Pure projection of the raw hunks into the unified + split row models.
const parsed = computed(() =>
  parseDiff({
    hunks: props.hunks,
    fileName: props.fileName,
    oldContent: props.oldContent,
    newContent: props.newContent
  })
);

// --- Line-level selection (unified mode) ------------------------------------
// Sub-hunk staging: pick individual +/- lines, then stage/unstage just those.
// Selection is scoped to a single hunk — clicking a line in another hunk starts
// fresh — which keeps the emitted patch a clean single-hunk apply. Only the
// unified view is selectable; split keeps whole-hunk staging.
const selHunk = ref<number | null>(null);
const selLines = ref<Set<number>>(new Set());
const lastSel = ref<number | null>(null);

const canSelect = (row: DisplayRow) =>
  row.type !== 'expander' &&
  !!props.hunkAction &&
  (row.type === 'add' || row.type === 'del');

// Body indices of the selectable (+/-) lines of a hunk, in display order — the
// span a shift-click range is filled across.
const selectableInHunk = (hunkIndex: number): number[] =>
  parsed.value.unified
    .filter(
      (r) =>
        r.hunkIndex === hunkIndex &&
        (r.type === 'add' || r.type === 'del') &&
        r.lineIndex !== undefined
    )
    .map((r) => r.lineIndex!);

function toggleLine(row: DisplayRow, ev: MouseEvent) {
  if (
    row.type === 'expander' ||
    !canSelect(row) ||
    row.lineIndex === undefined ||
    row.hunkIndex === undefined
  )
    return;
  if (selHunk.value !== row.hunkIndex) {
    selHunk.value = row.hunkIndex;
    selLines.value = new Set();
    lastSel.value = null;
  }
  const next = new Set(selLines.value);
  if (ev.shiftKey && lastSel.value !== null) {
    const all = selectableInHunk(row.hunkIndex);
    const a = all.indexOf(lastSel.value);
    const b = all.indexOf(row.lineIndex);
    if (a !== -1 && b !== -1) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      for (let i = lo; i <= hi; i++) next.add(all[i]!);
    }
  } else if (next.has(row.lineIndex)) {
    next.delete(row.lineIndex);
  } else {
    next.add(row.lineIndex);
  }
  lastSel.value = row.lineIndex;
  selLines.value = next;
  if (next.size === 0) {
    selHunk.value = null;
    lastSel.value = null;
  }
}

const isSelected = (row: DisplayRow) =>
  row.type !== 'expander' &&
  selHunk.value === row.hunkIndex &&
  row.lineIndex !== undefined &&
  selLines.value.has(row.lineIndex);

const selectedCount = computed(() => selLines.value.size);

function stageSelected() {
  if (selHunk.value === null || selLines.value.size === 0) return;
  const hunk = props.hunks[selHunk.value];
  if (!hunk) return;
  emit('stageLines', {
    hunk,
    lines: [...selLines.value].sort((a, b) => a - b)
  });
  selLines.value = new Set();
  selHunk.value = null;
  lastSel.value = null;
}

// A re-diff (after any stage/unstage) swaps the hunks array out; drop the now
// meaningless selection so stale indices can't be applied.
watch(
  () => props.hunks,
  () => {
    selLines.value = new Set();
    selHunk.value = null;
    lastSel.value = null;
    expanded.value = new Set();
  }
);

const rowBg: Record<string, string> = {
  add: 'bg-green-500/15',
  del: 'bg-red-500/15',
  context: '',
  empty: 'bg-muted/40'
};

// Keep the two split panes vertically in sync.
const leftPane = ref<HTMLElement | null>(null);
const rightPane = ref<HTMLElement | null>(null);
let lock = false;
function sync(src: 'l' | 'r') {
  if (lock) return;
  const from = src === 'l' ? leftPane.value : rightPane.value;
  const to = src === 'l' ? rightPane.value : leftPane.value;
  if (!from || !to) return;
  lock = true;
  to.scrollTop = from.scrollTop;
  requestAnimationFrame(() => {
    lock = false;
  });
}

const gutter =
  'sticky z-10 shrink-0 bg-background px-2 text-right text-muted-foreground select-none';

// --- Virtualization ---------------------------------------------------------
// Every row is a single line pinned to an exact 20px box (`h-5 leading-5`), so
// we use a fixed size and skip per-row measurement. Measuring would re-round the
// 12px×1.6 line box to 19/20px frame-by-frame while scrolling, nudging paddingTop
// and making the row backgrounds flicker — a fixed height keeps it rock steady.
const ROW_H = 20;

// Only the active mode feeds rows to its virtualizer (the hidden one stays at
// count 0 and does no work). Whole-file view drops the single `@@` header row.
const unifiedRows = computed(() => {
  if (props.mode !== 'unified') return [];
  return props.hideHunkHeader
    ? parsed.value.unified.filter((r) => r.type !== 'hunk')
    : parsed.value.unified;
});

// --- Collapse long unchanged runs (whole-file view) -------------------------
const COLLAPSE_MIN = 8; // only fold a context run longer than this …
const COLLAPSE_PAD = 3; // … keeping this many lines visible at each edge
const expanded = ref<Set<string>>(new Set());
const expandRegion = (key: string) => {
  expanded.value = new Set(expanded.value).add(key);
};

// The unified rows actually rendered: in whole-file view, long stretches of
// unchanged context fold into one "… N unchanged lines" expander (until the user
// expands them). Hunk view already ships minimal context, so it's left as-is.
const unifiedDisplay = computed<DisplayRow[]>(() => {
  const rows = unifiedRows.value;
  if (!props.hideHunkHeader) return rows;
  const out: DisplayRow[] = [];
  let run: UnifiedRow[] = [];
  const flush = () => {
    const hidden = run.length - COLLAPSE_PAD * 2;
    const key = `c${run[0]?.oldNo ?? ''}`;
    if (run.length > COLLAPSE_MIN && hidden >= 2 && !expanded.value.has(key)) {
      out.push(
        ...run.slice(0, COLLAPSE_PAD),
        { type: 'expander', key, count: hidden },
        ...run.slice(-COLLAPSE_PAD)
      );
    } else {
      out.push(...run);
    }
    run = [];
  };
  for (const r of rows) {
    if (r.type === 'context') run.push(r);
    else {
      flush();
      out.push(r);
    }
  }
  flush();
  return out;
});

const splitRows = computed(() =>
  props.mode === 'split' ? parsed.value.split : []
);

const unifiedScroll = ref<HTMLElement | null>(null);

function makeVirtualizer({
  count,
  getEl
}: {
  count: Ref<number>;
  getEl: () => HTMLElement | null;
}) {
  const virt = useVirtualizer(
    computed(() => ({
      count: count.value,
      getScrollElement: getEl,
      estimateSize: () => ROW_H,
      overscan: 24
    }))
  );
  const items = computed(() => virt.value.getVirtualItems());
  const padTop = computed(() => items.value[0]?.start ?? 0);
  const padBottom = computed(() => {
    const last = items.value[items.value.length - 1];
    return last ? virt.value.getTotalSize() - last.end : 0;
  });
  // Measure a row's real height — wired only when word-wrap makes rows variable.
  // With wrap off rows are a fixed `h-5`, so this reports a steady 20px.
  const measure = (el: Element | null) => {
    if (el) virt.value.measureElement(el);
  };
  return reactive({ items, padTop, padBottom, measure });
}

const unifiedCount = computed(() => unifiedDisplay.value.length);
const splitCount = computed(() => splitRows.value.length);

const uv = makeVirtualizer({
  count: unifiedCount,
  getEl: () => unifiedScroll.value
});
const lv = makeVirtualizer({ count: splitCount, getEl: () => leftPane.value });
const rv = makeVirtualizer({ count: splitCount, getEl: () => rightPane.value });

// Pair each on-screen virtual item with its row data for the template.
const uVisible = computed(() =>
  uv.items.map((vi) => ({ vi, row: unifiedDisplay.value[vi.index]! }))
);
const lVisible = computed(() =>
  lv.items.map((vi) => ({ vi, row: parsed.value.split[vi.index]! }))
);
const rVisible = computed(() =>
  rv.items.map((vi) => ({ vi, row: parsed.value.split[vi.index]! }))
);
</script>

<template>
  <!-- unified -->
  <div
    v-if="mode === 'unified'"
    ref="unifiedScroll"
    class="hljs-diff h-full overflow-auto font-mono text-xs leading-[1.6]"
  >
    <div
      :class="wrap ? 'w-full' : 'w-max min-w-full'"
      :style="{
        paddingTop: `${uv.padTop}px`,
        paddingBottom: `${uv.padBottom}px`
      }"
    >
      <template v-for="{ vi, row } in uVisible" :key="vi.key">
        <!-- a folded run of unchanged lines (whole-file view) -->
        <button
          v-if="row.type === 'expander'"
          :ref="uv.measure"
          :data-index="vi.index"
          type="button"
          class="flex h-5 w-full items-center gap-2 bg-muted/40 px-2 text-[11px] text-muted-foreground italic hover:bg-muted/70"
          @click="expandRegion(row.key)"
        >
          <NuxtIcon name="lucide:unfold-vertical" class="size-3 shrink-0" />
          {{ t('diff.expand', { n: row.count }) }}
        </button>
        <div
          v-else
          :ref="uv.measure"
          :data-index="vi.index"
          :class="[
            'flex leading-5',
            wrap ? 'min-h-5' : 'h-5',
            canSelect(row) && 'cursor-pointer'
          ]"
          @click="toggleLine(row, $event)"
        >
          <div
            v-if="row.type === 'hunk'"
            class="sticky left-0 flex w-full items-center bg-accent"
          >
            <span
              class="px-2 whitespace-pre text-muted-foreground"
              v-html="row.html"
            />
            <button
              v-if="hunkAction"
              class="ml-auto cursor-pointer px-2 text-[10px] font-medium text-muted-foreground hover:text-foreground"
              @click="emit('stageHunk', hunks[row.hunkIndex!]!)"
            >
              {{ hunkAction === 'stage' ? '+ stage' : '− unstage' }}
            </button>
            <button
              v-if="hunkAction === 'stage'"
              class="cursor-pointer px-2 text-[10px] font-medium text-muted-foreground hover:text-destructive"
              @click="emit('discardHunk', hunks[row.hunkIndex!]!)"
            >
              ✕ discard
            </button>
            <button
              v-if="
                hunkAction && selHunk === row.hunkIndex && selectedCount > 0
              "
              class="cursor-pointer px-2 text-[10px] font-medium text-primary hover:underline"
              @click="stageSelected"
            >
              {{ hunkAction === 'stage' ? '+ stage' : '− unstage' }}
              {{ selectedCount }}
            </button>
          </div>
          <template v-else>
            <span :class="[gutter, 'left-0 w-12']">{{ row.oldNo ?? '' }}</span>
            <span :class="[gutter, 'left-12 w-12']">{{ row.newNo ?? '' }}</span>
            <span
              class="sticky left-24 z-10 w-4 shrink-0 bg-background text-center select-none"
              :class="
                isSelected(row)
                  ? 'font-bold text-primary'
                  : 'text-muted-foreground'
              "
              >{{
                isSelected(row)
                  ? '✓'
                  : row.type === 'add'
                    ? '+'
                    : row.type === 'del'
                      ? '-'
                      : ''
              }}</span
            >
            <span
              class="grow px-1"
              :class="[
                wrap ? 'break-words whitespace-pre-wrap' : 'whitespace-pre',
                isSelected(row) ? 'bg-primary/25' : rowBg[row.type]
              ]"
              v-html="row.html"
            />
          </template>
        </div>
      </template>
    </div>
  </div>

  <!-- split: two resizable panes, each scrolls its own code; vertical synced -->
  <UiResizablePanelGroup
    v-else
    direction="horizontal"
    class="hljs-diff h-full font-mono text-xs leading-[1.6]"
  >
    <UiResizablePanel :default-size="50" :min-size="15">
      <div
        ref="leftPane"
        class="diff-no-vscroll h-full overflow-auto"
        @scroll="sync('l')"
      >
        <div
          class="w-max min-w-full"
          :style="{
            paddingTop: `${lv.padTop}px`,
            paddingBottom: `${lv.padBottom}px`
          }"
        >
          <div
            v-for="{ vi, row: r } in lVisible"
            :key="vi.key"
            class="flex h-5 leading-5"
          >
            <div
              v-if="r.hunk !== undefined"
              class="sticky left-0 flex w-full items-center bg-accent"
            >
              <span
                class="px-2 whitespace-pre text-muted-foreground"
                v-html="r.hunk"
              />
              <button
                v-if="hunkAction"
                class="ml-auto cursor-pointer px-2 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                @click="emit('stageHunk', hunks[r.hunkIndex!]!)"
              >
                {{ hunkAction === 'stage' ? '+ stage' : '− unstage' }}
              </button>
              <button
                v-if="hunkAction === 'stage'"
                class="cursor-pointer px-2 text-[10px] font-medium text-muted-foreground hover:text-destructive"
                @click="emit('discardHunk', hunks[r.hunkIndex!]!)"
              >
                ✕ discard
              </button>
            </div>
            <template v-else>
              <span :class="[gutter, 'left-0 w-12']">{{
                r.left!.no ?? ''
              }}</span>
              <span
                class="grow px-1 whitespace-pre"
                :class="rowBg[r.left!.type]"
                v-html="r.left!.html"
              />
            </template>
          </div>
        </div>
      </div>
    </UiResizablePanel>
    <UiResizableHandle class="z-20" />
    <UiResizablePanel :default-size="50" :min-size="15">
      <div ref="rightPane" class="h-full overflow-auto" @scroll="sync('r')">
        <div
          class="w-max min-w-full"
          :style="{
            paddingTop: `${rv.padTop}px`,
            paddingBottom: `${rv.padBottom}px`
          }"
        >
          <div
            v-for="{ vi, row: r } in rVisible"
            :key="vi.key"
            class="flex h-5 leading-5"
          >
            <span
              v-if="r.hunk !== undefined"
              class="sticky left-0 bg-accent px-2 whitespace-pre text-muted-foreground"
              v-html="r.hunk"
            />
            <template v-else>
              <span :class="[gutter, 'left-0 w-12']">{{
                r.right!.no ?? ''
              }}</span>
              <span
                class="grow px-1 whitespace-pre"
                :class="rowBg[r.right!.type]"
                v-html="r.right!.html"
              />
            </template>
          </div>
        </div>
      </div>
    </UiResizablePanel>
  </UiResizablePanelGroup>
</template>
