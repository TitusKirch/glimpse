<script setup lang="ts">
import { toast } from 'vue-sonner';

const open = defineModel<boolean>('open', { required: true });
const { t, locale, locales, setLocale } = useI18n();
const colorMode = useColorMode();
const layout = useLayoutStore();

// Dev-only: fire one of each toast kind to preview styling.
const toastKinds = [
  { kind: 'info', fn: () => toast.info(t('settings.dev.toastInfo')) },
  { kind: 'success', fn: () => toast.success(t('settings.dev.toastSuccess')) },
  { kind: 'warning', fn: () => toast.warning(t('settings.dev.toastWarning')) },
  { kind: 'error', fn: () => toast.error(t('settings.dev.toastError')) }
] as const;

// Left navigation pages. The Developer page only appears when dev mode is on.
const pages = computed(() => {
  const base = [
    { key: 'general', icon: 'lucide:sliders-horizontal' },
    { key: 'appearance', icon: 'lucide:palette' },
    { key: 'language', icon: 'lucide:languages' }
  ];
  if (layout.devMode) {
    base.push({ key: 'developer', icon: 'lucide:flask-conical' });
  }
  return base;
});
const page = ref('general');

// Leave the Developer page if dev mode is switched off while it is open.
watch(
  () => layout.devMode,
  (on) => {
    if (!on && page.value === 'developer') page.value = 'general';
  }
);

const themeOptions = ['system', 'light', 'dark'] as const;
const diffModeOptions = ['split', 'unified'] as const;
const fileViewOptions = ['list', 'tree'] as const;

// Language: bind the select straight to the active i18n locale.
const FLAG: Record<string, string> = {
  de: 'flag:de-4x3',
  en: 'flag:gb-4x3'
};
const localeOptions = computed(() =>
  locales.value.map((l) => (typeof l === 'string' ? { code: l } : l))
);
const lang = computed({
  get: () => locale.value,
  set: (code: string) => {
    void setLocale(code as typeof locale.value);
  }
});
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent
      class="flex h-[85vh] w-[90vw] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
    >
      <UiDialogHeader class="border-b px-6 py-4">
        <UiDialogTitle>{{ t('settings.title') }}</UiDialogTitle>
        <UiDialogDescription class="sr-only">
          {{ t('settings.title') }}
        </UiDialogDescription>
      </UiDialogHeader>

      <div class="flex min-h-0 flex-1">
        <!-- left navigation (~1/5) -->
        <nav class="w-56 shrink-0 space-y-1 overflow-auto border-r p-2">
          <button
            v-for="p in pages"
            :key="p.key"
            class="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors"
            :class="
              page === p.key
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50'
            "
            @click="page = p.key"
          >
            <NuxtIcon :name="p.icon" class="size-4 shrink-0" />
            {{ t(`settings.${p.key}.title`) }}
          </button>
        </nav>

        <!-- content -->
        <div class="min-w-0 flex-1 overflow-auto p-6">
          <section v-if="page === 'general'" class="w-full space-y-8">
            <div>
              <h3
                class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {{ t('settings.general.developer') }}
              </h3>
              <div class="space-y-4">
                <div class="flex items-center justify-between gap-4">
                  <div class="min-w-0">
                    <p class="text-sm font-medium">
                      {{ t('settings.general.devMode') }}
                    </p>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.general.devModeHint') }}
                    </p>
                  </div>
                  <UiSwitch v-model="layout.devMode" class="shrink-0" />
                </div>
              </div>
            </div>
          </section>

          <section
            v-else-if="page === 'developer'"
            class="w-full space-y-8"
          >
            <div>
              <h3
                class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {{ t('settings.dev.toasts') }}
              </h3>
              <div class="flex items-center justify-between gap-4">
                <div class="min-w-0">
                  <p class="text-sm font-medium">
                    {{ t('settings.dev.toasts') }}
                  </p>
                  <p class="text-xs text-muted-foreground">
                    {{ t('settings.dev.toastsHint') }}
                  </p>
                </div>
                <div class="flex shrink-0 gap-2">
                  <UiButton
                    v-for="tk in toastKinds"
                    :key="tk.kind"
                    variant="outline"
                    size="sm"
                    @click="tk.fn()"
                  >
                    {{ t(`settings.dev.${tk.kind}`) }}
                  </UiButton>
                </div>
              </div>
            </div>
          </section>

          <section v-else-if="page === 'appearance'" class="w-full space-y-8">
            <div>
              <h3
                class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {{ t('settings.appearance.themeSection') }}
              </h3>
              <div class="flex items-center justify-between gap-4">
                <div class="min-w-0">
                  <p class="text-sm font-medium">
                    {{ t('settings.appearance.theme') }}
                  </p>
                  <p class="text-xs text-muted-foreground">
                    {{ t('settings.appearance.themeHint') }}
                  </p>
                </div>
                <UiSelect v-model="colorMode.preference">
                  <UiSelectTrigger class="w-44 shrink-0">
                    <UiSelectValue />
                  </UiSelectTrigger>
                  <UiSelectContent>
                    <UiSelectItem v-for="o in themeOptions" :key="o" :value="o">
                      {{ t(`settings.appearance.${o}`) }}
                    </UiSelectItem>
                  </UiSelectContent>
                </UiSelect>
              </div>
            </div>

            <div>
              <h3
                class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {{ t('settings.appearance.diffSection') }}
              </h3>
              <div class="space-y-4">
                <div class="flex items-center justify-between gap-4">
                  <div class="min-w-0">
                    <p class="text-sm font-medium">
                      {{ t('settings.appearance.diffMode') }}
                    </p>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.appearance.diffModeHint') }}
                    </p>
                  </div>
                  <UiSelect v-model="layout.diffMode">
                    <UiSelectTrigger class="w-44 shrink-0">
                      <UiSelectValue />
                    </UiSelectTrigger>
                    <UiSelectContent>
                      <UiSelectItem
                        v-for="m in diffModeOptions"
                        :key="m"
                        :value="m"
                      >
                        {{
                          m === 'split'
                            ? t('diff.sideBySide')
                            : t('diff.unified')
                        }}
                      </UiSelectItem>
                    </UiSelectContent>
                  </UiSelect>
                </div>

                <div class="flex items-center justify-between gap-4">
                  <div class="min-w-0">
                    <p class="text-sm font-medium">
                      {{ t('settings.appearance.fileView') }}
                    </p>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.appearance.fileViewHint') }}
                    </p>
                  </div>
                  <UiSelect v-model="layout.fileView">
                    <UiSelectTrigger class="w-44 shrink-0">
                      <UiSelectValue />
                    </UiSelectTrigger>
                    <UiSelectContent>
                      <UiSelectItem
                        v-for="v in fileViewOptions"
                        :key="v"
                        :value="v"
                      >
                        {{ t(`fileView.${v}`) }}
                      </UiSelectItem>
                    </UiSelectContent>
                  </UiSelect>
                </div>
              </div>
            </div>
          </section>

          <section v-else-if="page === 'language'" class="w-full space-y-6">
            <div class="flex items-center justify-between gap-4">
              <div class="min-w-0">
                <p class="text-sm font-medium">
                  {{ t('settings.language.label') }}
                </p>
                <p class="text-xs text-muted-foreground">
                  {{ t('settings.language.hint') }}
                </p>
              </div>
              <UiSelect v-model="lang">
                <UiSelectTrigger class="w-44 shrink-0">
                  <span class="flex items-center gap-2">
                    <NuxtIcon :name="FLAG[lang]" class="size-4 shrink-0" />
                    <UiSelectValue />
                  </span>
                </UiSelectTrigger>
                <UiSelectContent>
                  <UiSelectItem
                    v-for="l in localeOptions"
                    :key="l.code"
                    :value="l.code"
                  >
                    <NuxtIcon :name="FLAG[l.code]" class="size-4 shrink-0" />
                    {{ t(`settings.language.name.${l.code}`) }}
                  </UiSelectItem>
                </UiSelectContent>
              </UiSelect>
            </div>
          </section>
        </div>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>
