<script setup lang="ts">
import { toast } from 'vue-sonner';
import { z } from 'zod';

const { t } = useI18n();
const settings = useSettingsStore();

// Triggers page: fire one of each toast kind (with title + description).
const toastKinds = [
  { kind: 'info', variant: 'info', fn: toast.info },
  { kind: 'success', variant: 'success', fn: toast.success },
  { kind: 'warning', variant: 'warning', fn: toast.warning },
  { kind: 'error', variant: 'destructive', fn: toast.error }
] as const;
function fireToast(tk: (typeof toastKinds)[number]) {
  tk.fn(t(`settings.triggers.${tk.kind}.title`), {
    description: t(`settings.triggers.${tk.kind}.description`)
  });
}

// Triggers page: open the promise-based dialogs you don't normally see directly
// (they fire from store actions in real use), and report the outcome as a toast.
const confirmDialog = useConfirm();
const promptDialog = usePrompt();
const pullStrategy = usePullStrategy();
async function triggerConfirm() {
  const ok = await confirmDialog.confirm({
    titleKey: 'settings.triggers.confirm.title',
    descriptionKey: 'settings.triggers.confirm.description',
    confirmKey: 'settings.triggers.confirm.action',
    destructive: true
  });
  toast.info(
    t(
      ok ? 'settings.triggers.confirm.confirmed' : 'settings.triggers.cancelled'
    )
  );
}
async function triggerPrompt() {
  const value = await promptDialog.prompt({
    titleKey: 'settings.triggers.prompt.title',
    labelKey: 'settings.triggers.prompt.label',
    placeholderKey: 'settings.triggers.prompt.placeholder',
    submitKey: 'settings.triggers.prompt.submit',
    schema: z.string().min(1, 'settings.triggers.prompt.required')
  });
  // On save, echo the entered value back in the toast; on cancel, just say so.
  if (value === null) {
    toast.info(t('settings.triggers.cancelled'));
    return;
  }
  toast.success(t('settings.triggers.prompt.saved'), { description: value });
}
async function triggerPull() {
  const strategy = await pullStrategy.choose({
    initial: settings.pullStrategy
  });
  toast.info(
    strategy === null
      ? t('settings.triggers.cancelled')
      : t('settings.triggers.pull.result', { strategy })
  );
}
</script>

<template>
  <!-- Triggers: fire the toasts and the dialogs you don't normally see
       directly (they pop from store actions in real use). -->
  <section class="w-full space-y-8">
    <div>
      <h3
        class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {{ t('settings.triggers.toasts.label') }}
      </h3>
      <p class="mb-3 text-xs text-muted-foreground">
        {{ t('settings.triggers.toasts.hint') }}
      </p>
      <div class="flex flex-wrap gap-2">
        <UiButton
          v-for="tk in toastKinds"
          :key="tk.kind"
          :variant="tk.variant"
          size="sm"
          @click="fireToast(tk)"
        >
          {{ t(`settings.triggers.${tk.kind}.label`) }}
        </UiButton>
      </div>
    </div>

    <div>
      <h3
        class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {{ t('settings.triggers.dialogs.label') }}
      </h3>
      <p class="mb-3 text-xs text-muted-foreground">
        {{ t('settings.triggers.dialogs.hint') }}
      </p>
      <div class="flex flex-wrap gap-2">
        <UiButton
          variant="outline"
          size="sm"
          icon="lucide:circle-alert"
          @click="triggerConfirm"
        >
          {{ t('settings.triggers.confirm.button') }}
        </UiButton>
        <UiButton
          variant="outline"
          size="sm"
          icon="lucide:pencil"
          @click="triggerPrompt"
        >
          {{ t('settings.triggers.prompt.button') }}
        </UiButton>
        <UiButton
          variant="outline"
          size="sm"
          icon="lucide:git-merge"
          @click="triggerPull"
        >
          {{ t('settings.triggers.pull.button') }}
        </UiButton>
      </div>
    </div>
  </section>
</template>
