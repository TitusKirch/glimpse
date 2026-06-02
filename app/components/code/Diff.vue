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
}>();

const emit = defineEmits<{ stageHunk: [hunk: string] }>();

// Pure projection of the raw hunks into the unified + split row models.
const parsed = computed(() =>
  parseDiff({
    hunks: props.hunks,
    fileName: props.fileName,
    oldContent: props.oldContent,
    newContent: props.newContent
  })
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
// count 0 and does no work).
const unifiedRows = computed(() => {
  if (props.mode !== 'unified') return [];
  return props.hideHunkHeader
    ? parsed.value.unified.filter((r) => r.type !== 'hunk')
    : parsed.value.unified;
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
  return reactive({ items, padTop, padBottom });
}

const unifiedCount = computed(() => unifiedRows.value.length);
const splitCount = computed(() => splitRows.value.length);

const uv = makeVirtualizer({
  count: unifiedCount,
  getEl: () => unifiedScroll.value
});
const lv = makeVirtualizer({ count: splitCount, getEl: () => leftPane.value });
const rv = makeVirtualizer({ count: splitCount, getEl: () => rightPane.value });

// Pair each on-screen virtual item with its row data for the template.
const uVisible = computed(() =>
  uv.items.map((vi) => ({ vi, row: parsed.value.unified[vi.index]! }))
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
      class="w-max min-w-full"
      :style="{
        paddingTop: `${uv.padTop}px`,
        paddingBottom: `${uv.padBottom}px`
      }"
    >
      <div
        v-for="{ vi, row } in uVisible"
        :key="vi.key"
        class="flex h-5 leading-5"
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
        </div>
        <template v-else>
          <span :class="[gutter, 'left-0 w-12']">{{ row.oldNo ?? '' }}</span>
          <span :class="[gutter, 'left-12 w-12']">{{ row.newNo ?? '' }}</span>
          <span
            class="sticky left-24 z-10 w-4 shrink-0 bg-background text-center text-muted-foreground select-none"
            >{{
              row.type === 'add' ? '+' : row.type === 'del' ? '-' : ''
            }}</span
          >
          <span
            class="grow px-1 whitespace-pre"
            :class="rowBg[row.type]"
            v-html="row.html"
          />
        </template>
      </div>
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
