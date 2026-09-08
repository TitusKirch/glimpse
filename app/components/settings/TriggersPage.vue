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

// Triggers page: provoke the failures the app is least able to rehearse. The
// fatal error page, the diagnostics block it renders and its manual update check
// only show when something genuinely breaks, which makes them the least-looked-at
// surface in the app — reproducing any of it used to mean editing code and
// rebuilding.
//
// These are the one group here that ends the current session, so unlike the
// toasts and dialogs above each states plainly what it is about to do and waits
// for a confirmation. The three are deliberately different failures, not three
// routes to one screen: a broken render hands over to error.vue, a stray
// rejection is a toast on an app that still works, and a dead backend leaves the
// call hanging with nothing to show at all.
const CRASH_ORIGIN = 'Settings → Developer → Triggers';

// Throws as soon as it is rendered, so the error arrives out of a real render
// rather than being reported by hand — which is what the app's global handler
// (app/plugins/errors.client.ts) turns into the fatal error page.
const crashing = ref(false);
const CrashOnRender = defineComponent({
  name: 'CrashOnRender',
  setup: () => () => {
    throw new Error(`glimpse: deliberate render error from ${CRASH_ORIGIN}`);
  }
});

// Only the desktop shell has a backend to crash; in the browser demo there is
// nothing behind the IPC seam.
const desktop = isTauri();

const crashes = [
  {
    key: 'render',
    icon: 'lucide:layout-panel-top',
    desktopOnly: false,
    fire: () => {
      crashing.value = true;
    }
  },
  {
    key: 'rejection',
    icon: 'lucide:unplug',
    desktopOnly: false,
    fire: () => {
      void Promise.reject(
        new Error(
          `glimpse: deliberate unhandled rejection from ${CRASH_ORIGIN}`
        )
      );
    }
  },
  {
    key: 'backend',
    icon: 'lucide:bomb',
    desktopOnly: true,
    // The panic kills the command's task while the process keeps running, so
    // this call is never answered. Nothing awaits it on purpose: whether a git
    // call that never comes back leaves a spinner turning forever is exactly
    // what there is to look at.
    fire: () => {
      void tauriInvoke<null>({ command: 'dev_panic' });
    }
  }
] as const;

async function triggerCrash(crash: (typeof crashes)[number]) {
  const ok = await confirmDialog.confirm({
    titleKey: `settings.triggers.crashes.${crash.key}.title`,
    descriptionKey: `settings.triggers.crashes.${crash.key}.description`,
    confirmKey: `settings.triggers.crashes.${crash.key}.action`,
    destructive: true
  });
  if (!ok) {
    toast.info(t('settings.triggers.cancelled'));
    return;
  }
  crash.fire();
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

    <div>
      <h3
        class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {{ t('settings.triggers.crashes.label') }}
      </h3>
      <p class="mb-3 text-xs text-muted-foreground">
        {{ t('settings.triggers.crashes.hint') }}
      </p>
      <div class="flex flex-wrap gap-2">
        <UiButton
          v-for="crash in crashes"
          :key="crash.key"
          variant="destructive"
          size="sm"
          :icon="crash.icon"
          :disabled="crash.desktopOnly && !desktop"
          @click="triggerCrash(crash)"
        >
          {{ t(`settings.triggers.crashes.${crash.key}.button`) }}
        </UiButton>
      </div>
      <!-- Renders only once the render crash is confirmed, and throws the
           moment it does. -->
      <component :is="CrashOnRender" v-if="crashing" />
    </div>
  </section>
</template>
