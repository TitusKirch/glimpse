<script setup lang="ts">
// Renders the shared pull-strategy request (see usePullStrategy). Shown when a
// pull can't fast-forward and the user must choose how to reconcile. Mounted
// once in app.vue. Each option resolves the pending promise immediately.
import type { PullStrategy } from '~/stores/layout';

const { request, answer } = usePullStrategy();
const { t } = useI18n();

const open = computed({
  get: () => !!request.value,
  set: (v: boolean) => {
    if (!v) answer(null);
  }
});

const options: { value: PullStrategy; icon: string; label: string }[] = [
  {
    value: 'merge',
    icon: 'lucide:git-merge',
    label: 'settings.general.pullStrategy.merge'
  },
  {
    value: 'rebase',
    icon: 'lucide:git-pull-request-arrow',
    label: 'settings.general.pullStrategy.rebase'
  },
  {
    value: 'ff-only',
    icon: 'lucide:fast-forward',
    label: 'settings.general.pullStrategy.ffOnly'
  }
];
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent v-if="request" class="max-w-sm">
      <UiDialogHeader>
        <UiDialogTitle>{{ t('pull.diverged.title') }}</UiDialogTitle>
        <UiDialogDescription>{{
          t('pull.diverged.description')
        }}</UiDialogDescription>
      </UiDialogHeader>
      <div class="flex flex-col gap-2">
        <UiButton
          v-for="o in options"
          :key="o.value"
          :variant="o.value === request.initial ? 'default' : 'outline'"
          class="justify-start"
          :icon="o.icon"
          @click="answer(o.value)"
        >
          {{ t(o.label) }}
        </UiButton>
      </div>
      <div class="flex justify-end">
        <UiButton variant="ghost" @click="answer(null)">
          {{ t('common.cancel') }}
        </UiButton>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>
