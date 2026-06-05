<script setup lang="ts">
// Visual diff for image files: the committed (HEAD) image beside the working-tree
// one, plus an onion-skin overlay with an opacity slider. Data URLs come from the
// backend (image_diff); refetched whenever the file changes.
import type { ImageDiff } from '~/types/bindings';

const props = defineProps<{ file: string }>();
const { t } = useI18n();
const repo = useRepoStore();

const data = ref<ImageDiff | null>(null);
const loading = ref(false);
const opacity = ref(50);

async function load() {
  loading.value = true;
  data.value = null;
  try {
    data.value = await gitClient.imageDiff({
      path: repo.repoPath,
      file: props.file
    });
  } finally {
    loading.value = false;
  }
}
watch(() => [props.file, repo.repoPath], load, { immediate: true });

const cell =
  'flex min-h-24 items-center justify-center rounded-md border bg-muted/30 p-2';
const img = 'max-h-64 max-w-full object-contain';
</script>

<template>
  <div class="h-full overflow-auto p-6">
    <div v-if="loading" class="flex h-full items-center justify-center">
      <UiSkeleton class="h-48 w-72" />
    </div>
    <div v-else-if="data" class="mx-auto max-w-3xl space-y-6">
      <!-- side by side -->
      <div class="grid grid-cols-2 gap-4">
        <figure class="space-y-2 text-center">
          <figcaption class="text-xs font-medium text-muted-foreground">
            {{ t('diff.image.old') }}
          </figcaption>
          <div :class="cell">
            <img
              v-if="data.old"
              :src="data.old"
              :class="img"
              :alt="t('diff.image.old')"
            />
            <span v-else class="text-xs text-muted-foreground">
              {{ t('diff.image.absent') }}
            </span>
          </div>
        </figure>
        <figure class="space-y-2 text-center">
          <figcaption class="text-xs font-medium text-muted-foreground">
            {{ t('diff.image.new') }}
          </figcaption>
          <div :class="cell">
            <img
              v-if="data.new"
              :src="data.new"
              :class="img"
              :alt="t('diff.image.new')"
            />
            <span v-else class="text-xs text-muted-foreground">
              {{ t('diff.image.absent') }}
            </span>
          </div>
        </figure>
      </div>

      <!-- onion skin (only when both sides exist) -->
      <div v-if="data.old && data.new" class="space-y-2">
        <div class="flex items-center gap-3">
          <span class="shrink-0 text-xs text-muted-foreground">
            {{ t('diff.image.onionSkin') }}
          </span>
          <input
            v-model.number="opacity"
            type="range"
            min="0"
            max="100"
            class="flex-1 accent-primary"
          />
        </div>
        <div class="grid place-items-center rounded-md border bg-muted/30 p-2">
          <img
            :src="data.old"
            class="col-start-1 row-start-1 max-h-72"
            alt=""
          />
          <img
            :src="data.new"
            class="col-start-1 row-start-1 max-h-72"
            :style="{ opacity: opacity / 100 }"
            alt=""
          />
        </div>
      </div>
    </div>
  </div>
</template>
