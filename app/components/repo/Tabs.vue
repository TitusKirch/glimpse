<script setup lang="ts">
import draggable from 'vuedraggable';
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  tabIntoView,
  tabStripEdges,
  tabStripPage,
  tabStripScrollTarget
} from '@/composables/tabStrip';
import type { RepoState } from '@/stores/repo';

const repo = useRepoStore();
const openRepoDialog = useOverlay('openRepo');
const { t } = useI18n();

// Dismiss the "+" button's tooltip as the open-repo dialog appears, so it
// doesn't linger (or reappear on focus-return) over the dialog.
const {
  open: openRepoTip,
  onOpenChange: onOpenRepoTipChange,
  hover: openRepoHover,
  onActivate: onOpenRepo
} = useDismissableTooltip();

// Suppress tooltips (e.g. a tab's WSL-distro tooltip) while a tab reorder drag
// is in flight, so the pointer sweeping over tabs doesn't pop them mid-drag.
const { startReorder, endReorder } = useDragReorder();

// Map a WSL distro name to its brand icon (simple-icons), falling back to the
// generic Tux penguin when the distro isn't recognised.
function distroIcon(distro?: string): string {
  const d = (distro ?? '').toLowerCase();
  if (d.includes('ubuntu')) return 'simple-icons:ubuntu';
  if (d.includes('debian')) return 'simple-icons:debian';
  if (d.includes('arch')) return 'simple-icons:archlinux';
  if (d.includes('fedora')) return 'simple-icons:fedora';
  if (d.includes('suse')) return 'simple-icons:opensuse';
  if (d.includes('kali')) return 'simple-icons:kalilinux';
  if (d.includes('alpine')) return 'simple-icons:alpinelinux';
  if (d.includes('mint')) return 'simple-icons:linuxmint';
  return 'simple-icons:linux';
}

// While a WSL tab is still resolving its distro, show a spinner instead of
// flashing the generic penguin before the real distro icon arrives.
function tabDistroIcon(tab: RepoState): string {
  return tab.resolving ? 'lucide:loader-circle' : distroIcon(tab.distro);
}

// Reorder via SortableJS (vuedraggable). `forceFallback` makes it drive the drag
// with its own pointer-based fallback instead of the native HTML5 Drag-and-Drop
// API. SortableJS uses native DnD by default, but the Windows WebView2 release
// build's OS-level drag handler swallows those events, so reordering silently
// dies there (it still works in the browser and the WebKitGTK `tauri dev` shell).
// `fallbackTolerance` keeps a plain click on a tab from registering as a drag.
// Persist the new order by its ids.
function onReorder(tabs: RepoState[]) {
  repo.reorderTabs(tabs.map((tab) => tab.id));
}

// ── Scrolling the strip ───────────────────────────────────────────────────
// Tabs no longer shrink to fit: past the available width the strip overflows
// and scrolls. Every decision about where it scrolls to lives in
// `~/composables/tabStrip` as pure arithmetic; this component only reads the
// DOM geometry and applies the answer.
const strip = ref<HTMLElement | null>(null);
const edges = ref({ left: false, right: false });

function maxScroll(el: HTMLElement): number {
  return Math.max(0, el.scrollWidth - el.clientWidth);
}

function syncEdges() {
  const el = strip.value;
  edges.value = el
    ? tabStripEdges(el.scrollLeft, maxScroll(el))
    : { left: false, right: false };
}

function onWheel(event: WheelEvent) {
  const el = strip.value;
  if (!el) return;
  const next = tabStripScrollTarget(event, el.scrollLeft, maxScroll(el));
  // Only take the event when the strip actually moves — at either end the page
  // keeps whatever it would otherwise have done with it.
  if (!next.claim) return;
  event.preventDefault();
  el.scrollLeft = next.scrollLeft;
}

function page(direction: 1 | -1) {
  const el = strip.value;
  if (!el) return;
  el.scrollTo({
    left: tabStripPage(direction, el.scrollLeft, el.clientWidth, maxScroll(el)),
    behavior: 'smooth'
  });
}

// Selecting a repo anywhere — the command palette, recent repos, a shortcut —
// has to bring its tab into view; the active tab is no use off-screen.
async function revealActiveTab() {
  await nextTick();
  const el = strip.value;
  if (!el || !repo.activeTabId) return;
  const tab = el.querySelector<HTMLElement>(
    `[data-tab-id="${CSS.escape(repo.activeTabId)}"]`
  );
  if (!tab) return;
  const left = tabIntoView(tab.offsetLeft, tab.offsetWidth, {
    scrollLeft: el.scrollLeft,
    viewportWidth: el.clientWidth,
    maxScroll: maxScroll(el)
  });
  if (left !== el.scrollLeft) el.scrollTo({ left, behavior: 'smooth' });
}

watch(() => repo.activeTabId, revealActiveTab);
// Opening or closing a repo changes what overflows, so the chevrons have to be
// re-derived even when nothing was scrolled.
watch(
  () => repo.tabs.length,
  () => nextTick(syncEdges)
);

// The strip's own width changes with the window and with the header's other
// controls, neither of which fires a scroll event.
let observer: ResizeObserver | undefined;

onMounted(() => {
  syncEdges();
  void revealActiveTab();
  if (typeof ResizeObserver === 'undefined') return;
  observer = new ResizeObserver(syncEdges);
  if (strip.value) observer.observe(strip.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = undefined;
});
</script>

<template>
  <div class="flex min-w-0 items-center gap-1">
    <!-- Positioning context for the chevrons, which overlay the strip rather
         than sitting in the flex row: occupying no space means no tab shifts
         sideways the moment scrolling becomes possible. -->
    <div class="relative min-w-0">
      <div
        ref="strip"
        class="tabstrip flex min-w-0 items-center gap-1 overflow-x-auto"
        @wheel="onWheel"
        @scroll="syncEdges"
      >
        <!-- `shrink-0` on each tab is the whole change in layout terms: a tab
             is as wide as its contents and never narrower, so the strip
             overflows instead of compressing every name into a stub.

             This sits outside <draggable> deliberately. Vue renders a comment
             as a real node, and vuedraggable requires exactly one node from
             its slots — a comment in either the default or the item slot makes
             it two and throws on mount. -->
        <draggable
          :model-value="repo.tabs"
          item-key="id"
          tag="div"
          class="flex items-center gap-1"
          :animation="150"
          :force-fallback="true"
          :fallback-tolerance="3"
          :scroll="true"
          :scroll-sensitivity="60"
          :scroll-speed="12"
          ghost-class="opacity-50"
          filter=".tab-close"
          :prevent-on-filter="false"
          @start="startReorder"
          @end="endReorder"
          @update:model-value="onReorder"
        >
          <template #item="{ element: tab }">
            <div
              :data-tab-id="tab.id"
              class="group flex shrink-0 cursor-pointer items-center gap-2 rounded-md py-1.5 pr-1 pl-3 text-sm transition-colors select-none"
              :class="
                tab.id === repo.activeTabId
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50'
              "
              @click="repo.selectTab(tab.id)"
            >
              <RepoTabLabel :name="tab.name" />
              <UiTooltip v-if="tab.flavor === 'wsl'">
                <UiTooltipTrigger as-child>
                  <!-- Fixed-size, non-rotating wrapper is the tooltip anchor: a
                       spinning icon's bounding box oscillates, which would make
                       the tooltip jitter up/down during the rotation. -->
                  <span
                    class="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground"
                  >
                    <NuxtIcon
                      :name="tabDistroIcon(tab)"
                      class="size-3.5"
                      :class="tab.resolving && 'animate-spin'"
                    />
                  </span>
                </UiTooltipTrigger>
                <UiTooltipContent>{{
                  tab.distro
                    ? `${t('platform.wsl')}: ${tab.distro}`
                    : t('platform.wsl')
                }}</UiTooltipContent>
              </UiTooltip>
              <button
                class="tab-close flex size-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-background/60"
                :class="
                  tab.id === repo.activeTabId
                    ? 'opacity-70 hover:opacity-100'
                    : 'opacity-0 group-hover:opacity-100'
                "
                :aria-label="t('actions.closeRepo')"
                @click.stop="repo.closeRepo(tab.id)"
              >
                <NuxtIcon name="lucide:x" class="size-3.5" />
              </button>
            </div>
          </template>
        </draggable>
      </div>

      <!-- Each chevron appears only while there is something to scroll that
           way. The gradient fades the tab it cuts off, so the strip reads as
           continuing rather than ending. -->
      <div
        v-if="edges.left"
        class="pointer-events-none absolute inset-y-0 left-0 flex items-center bg-gradient-to-r from-background via-background to-transparent pr-4"
      >
        <UiButton
          variant="ghost"
          size="icon"
          class="pointer-events-auto size-6"
          icon="lucide:chevron-left"
          :aria-label="t('actions.scrollTabsLeft')"
          @click="page(-1)"
        />
      </div>
      <div
        v-if="edges.right"
        class="pointer-events-none absolute inset-y-0 right-0 flex items-center bg-gradient-to-l from-background via-background to-transparent pl-4"
      >
        <UiButton
          variant="ghost"
          size="icon"
          class="pointer-events-auto size-6"
          icon="lucide:chevron-right"
          :aria-label="t('actions.scrollTabsRight')"
          @click="page(1)"
        />
      </div>
    </div>

    <!-- Outside the scroll container on purpose: opening a repo is an action of
         the header, not an item of the tab list, so it stays put. -->
    <UiTooltip :open="openRepoTip" @update:open="onOpenRepoTipChange">
      <UiTooltipTrigger as-child>
        <UiButton
          variant="ghost"
          size="icon"
          class="size-7 shrink-0"
          icon="lucide:plus"
          :aria-label="t('actions.openRepo')"
          v-bind="openRepoHover"
          @click="onOpenRepo(() => openRepoDialog.show())"
        />
      </UiTooltipTrigger>
      <UiTooltipContent>{{ t('actions.openRepo') }}</UiTooltipContent>
    </UiTooltip>
  </div>
</template>
