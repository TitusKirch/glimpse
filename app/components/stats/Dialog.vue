<script setup lang="ts">
// Repository insights: total commits, top contributors, recent activity and the
// most-changed files — all read-only, derived from git log on the backend.
// Mounted once in app.vue; fetched fresh each time it opens.
import type { RepoStats } from '~/types/bindings';

const { open } = useOverlay('stats');
const repo = useRepoStore();
const { t } = useI18n();

const data = ref<RepoStats | null>(null);
const loading = ref(false);

watch(open, async (isOpen) => {
  if (!isOpen) return;
  loading.value = true;
  data.value = null;
  try {
    data.value = await gitClient.repoStats(repo.repoPath);
  } finally {
    loading.value = false;
  }
});

const contributors = computed(() => data.value?.contributors.slice(0, 8) ?? []);
const maxContrib = computed(() => contributors.value[0]?.commits || 1);
const activity = computed(() => data.value?.activity.slice(-30) ?? []);
const maxActivity = computed(() =>
  Math.max(1, ...activity.value.map((a) => a.count))
);
const churn = computed(() => data.value?.churn.slice(0, 10) ?? []);
const maxChurn = computed(() => churn.value[0]?.changes || 1);
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent class="max-w-2xl">
      <UiDialogHeader>
        <UiDialogTitle>{{ t('stats.title') }}</UiDialogTitle>
        <UiDialogDescription class="sr-only">
          {{ t('stats.title') }}
        </UiDialogDescription>
      </UiDialogHeader>

      <div v-if="loading" class="space-y-3 py-2">
        <UiSkeleton v-for="n in 6" :key="n" class="h-6" />
      </div>
      <EmptyState
        v-else-if="!data || !data.totalCommits"
        icon="lucide:chart-column"
        :title="t('stats.empty')"
      />
      <div v-else class="max-h-[65vh] space-y-6 overflow-auto pr-1">
        <p class="text-sm">
          <span class="text-2xl font-semibold">{{ data.totalCommits }}</span>
          <span class="ml-1 text-muted-foreground">{{
            t('stats.totalCommits')
          }}</span>
        </p>

        <!-- contributors -->
        <section class="space-y-1.5">
          <h4 class="text-xs font-medium text-muted-foreground">
            {{ t('stats.contributors') }}
          </h4>
          <div
            v-for="c in contributors"
            :key="c.email"
            class="flex items-center gap-2 text-sm"
          >
            <span
              class="w-40 shrink-0 truncate"
              :title="`${c.name} <${c.email}>`"
              >{{ c.name }}</span
            >
            <div class="h-3 flex-1 overflow-hidden rounded bg-muted">
              <div
                class="h-full rounded bg-primary/70"
                :style="{ width: `${(c.commits / maxContrib) * 100}%` }"
              />
            </div>
            <span
              class="w-10 shrink-0 text-right text-xs text-muted-foreground"
              >{{ c.commits }}</span
            >
          </div>
        </section>

        <!-- recent activity -->
        <section v-if="activity.length" class="space-y-1.5">
          <h4 class="text-xs font-medium text-muted-foreground">
            {{ t('stats.activity') }}
          </h4>
          <div class="flex h-16 items-end gap-px">
            <div
              v-for="a in activity"
              :key="a.date"
              class="flex-1 rounded-t bg-primary/60"
              :style="{ height: `${(a.count / maxActivity) * 100}%` }"
              :title="`${a.date}: ${a.count}`"
            />
          </div>
        </section>

        <!-- most-changed files -->
        <section class="space-y-1.5">
          <h4 class="text-xs font-medium text-muted-foreground">
            {{ t('stats.churn') }}
          </h4>
          <div
            v-for="f in churn"
            :key="f.path"
            class="flex items-center gap-2 text-sm"
          >
            <span
              class="w-56 shrink-0 truncate font-mono text-xs"
              :title="f.path"
              >{{ f.path }}</span
            >
            <div class="h-3 flex-1 overflow-hidden rounded bg-muted">
              <div
                class="h-full rounded bg-amber-500/60"
                :style="{ width: `${(f.changes / maxChurn) * 100}%` }"
              />
            </div>
            <span
              class="w-10 shrink-0 text-right text-xs text-muted-foreground"
              >{{ f.changes }}</span
            >
          </div>
        </section>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>
