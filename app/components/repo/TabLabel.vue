<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

defineProps<{ name: string }>();

// A tab caps its label width and ellipsises the overflow, so the full repo name
// is only worth a tooltip when it actually doesn't fit. Every click on a tab
// passes through a hover, so a tooltip that merely repeats the visible text
// would pop on each pass — hence the measurement rather than an always-on
// tooltip (or a native `title`, which would also escape the drag suppression
// UiTooltip applies while tabs are being reordered).
const label = ref<HTMLElement | null>(null);
const truncated = ref(false);

function measure() {
  const el = label.value;
  truncated.value = el ? el.scrollWidth > el.clientWidth : false;
}

// The label's box changes as the tab strip gets crowded, and a late-loading font
// remeasures the text within an unchanged box — either can flip truncation, so
// observe the element instead of measuring once on mount. ResizeObserver fires
// on observe, which covers the initial measurement everywhere it exists; the
// explicit call covers environments without it.
let observer: ResizeObserver | undefined;

onMounted(() => {
  measure();
  if (typeof ResizeObserver === 'undefined') return;
  observer = new ResizeObserver(measure);
  if (label.value) observer.observe(label.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = undefined;
});
</script>

<template>
  <UiTooltip :disabled="!truncated">
    <UiTooltipTrigger as-child>
      <!-- `truncate` also resolves this flex item's automatic minimum size to
           zero, which is what lets the label shrink below the repo name instead
           of forcing the tab wider than the strip. -->
      <span ref="label" class="max-w-40 truncate">{{ name }}</span>
    </UiTooltipTrigger>
    <UiTooltipContent>{{ name }}</UiTooltipContent>
  </UiTooltip>
</template>
