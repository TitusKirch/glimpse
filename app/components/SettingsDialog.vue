<script setup lang="ts">
import { toast } from 'vue-sonner';
import { getVersion } from '@tauri-apps/api/app';

const open = defineModel<boolean>('open', { required: true });
const { t, locale, locales, setLocale } = useI18n();
const colorMode = useColorMode();
const layout = useLayoutStore();

// Dev-only: fire one of each toast kind (with title + description) to preview.
const toastKinds = [
  { kind: 'info', variant: 'info', fn: toast.info },
  { kind: 'success', variant: 'success', fn: toast.success },
  { kind: 'warning', variant: 'warning', fn: toast.warning },
  { kind: 'error', variant: 'destructive', fn: toast.error }
] as const;
function fireToast(tk: (typeof toastKinds)[number]) {
  tk.fn(t(`settings.dev.${tk.kind}.title`), {
    description: t(`settings.dev.${tk.kind}.description`)
  });
}

// Dev-only: every badge variant at a glance (the design-system reference).
const badgeKinds = [
  'default',
  'secondary',
  'outline',
  'info',
  'success',
  'warning',
  'destructive'
] as const;

// Left navigation, grouped into sections separated by dividers. The Developer
// section only appears when dev mode is on.
const navSections = computed(() => {
  const sections = [
    [
      { key: 'general', icon: 'lucide:sliders-horizontal' },
      { key: 'appearance', icon: 'lucide:palette' },
      { key: 'language', icon: 'lucide:languages' }
    ],
    [{ key: 'about', icon: 'lucide:info' }]
  ];
  if (layout.devMode) {
    sections.push([{ key: 'developer', icon: 'lucide:flask-conical' }]);
  }
  return sections;
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
// Diff font scale presets (multipliers applied via --mono-scale).
const fontScales = [
  { value: 0.85, key: 'small' },
  { value: 1, key: 'default' },
  { value: 1.15, key: 'large' },
  { value: 1.3, key: 'xlarge' }
] as const;

const { checking, checkForUpdates } = useUpdater();

// App version (Tauri only); shown on the About page.
const version = ref('dev');
onMounted(async () => {
  if (isTauri()) {
    try {
      version.value = await getVersion();
    } catch {
      version.value = 'dev';
    }
  }
});

const aboutLinks = [
  {
    title: 'GitHub',
    url: 'https://github.com/TitusKirch/glimpse',
    icon: 'simple-icons:github'
  },
  {
    title: 'Discord',
    url: 'https://discord.gg/cwFp2nx',
    icon: 'simple-icons:discord'
  },
  {
    title: 'Report a bug',
    url: 'https://github.com/TitusKirch/glimpse/issues',
    icon: 'lucide:bug'
  }
];

// Language: bind the select straight to the active i18n locale. Derive the flag
// from the locale's region subtag via Intl.Locale, which handles script/3-part
// tags (zh-Hant-TW -> TW). The Iconify flag set uses ISO country codes, so only
// two-letter regions map; anything else falls back to a globe.
function flagFor(code: string): string {
  let region: string | undefined;
  try {
    region = new Intl.Locale(code).region?.toLowerCase();
  } catch {
    region = undefined;
  }
  return region && /^[a-z]{2}$/.test(region)
    ? `flag:${region}-4x3`
    : 'lucide:globe';
}
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
        <!-- left navigation (~1/5), grouped with dividers -->
        <nav class="w-56 shrink-0 overflow-auto border-r p-2">
          <template v-for="(section, si) in navSections" :key="si">
            <UiSeparator v-if="si > 0" class="my-1.5" />
            <div class="space-y-1">
              <button
                v-for="p in section"
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
            </div>
          </template>
        </nav>

        <!-- content -->
        <div class="min-w-0 flex-1 overflow-auto p-6">
          <section v-if="page === 'general'" class="w-full space-y-8">
            <div>
              <h3
                class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {{ t('settings.general.gitSection') }}
              </h3>
              <div class="space-y-4">
                <div class="flex items-center justify-between gap-4">
                  <div class="min-w-0">
                    <p class="text-sm font-medium">
                      {{ t('settings.general.autoFetch.label') }}
                    </p>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.general.autoFetch.hint') }}
                    </p>
                  </div>
                  <UiSwitch v-model="layout.autoFetch" class="shrink-0" />
                </div>
                <div
                  v-if="layout.autoFetch"
                  class="flex items-center justify-between gap-4"
                >
                  <div class="min-w-0">
                    <p class="text-sm font-medium">
                      {{ t('settings.general.autoFetchInterval.label') }}
                    </p>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.general.autoFetchInterval.hint') }}
                    </p>
                  </div>
                  <UiInput
                    v-model.number="layout.autoFetchMinutes"
                    type="number"
                    min="1"
                    max="120"
                    class="w-24 shrink-0"
                  />
                </div>

                <div class="flex items-center justify-between gap-4">
                  <div class="min-w-0">
                    <p class="text-sm font-medium">
                      {{ t('settings.general.pullStrategy.label') }}
                    </p>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.general.pullStrategy.hint') }}
                    </p>
                  </div>
                  <UiSelect v-model="layout.pullStrategy">
                    <UiSelectTrigger class="w-44 shrink-0">
                      <UiSelectValue />
                    </UiSelectTrigger>
                    <UiSelectContent>
                      <UiSelectItem value="merge">
                        {{ t('settings.general.pullStrategy.merge') }}
                      </UiSelectItem>
                      <UiSelectItem value="rebase">
                        {{ t('settings.general.pullStrategy.rebase') }}
                      </UiSelectItem>
                    </UiSelectContent>
                  </UiSelect>
                </div>
              </div>
            </div>

            <div>
              <h3
                class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {{ t('settings.general.updatesSection') }}
              </h3>
              <div class="space-y-4">
                <div class="flex items-center justify-between gap-4">
                  <div class="min-w-0">
                    <p class="text-sm font-medium">
                      {{ t('settings.general.autoUpdate.label') }}
                    </p>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.general.autoUpdate.hint') }}
                    </p>
                  </div>
                  <UiSwitch v-model="layout.autoUpdate" class="shrink-0" />
                </div>

                <div class="flex items-center justify-between gap-4">
                  <div class="min-w-0">
                    <p class="text-sm font-medium">
                      {{ t('settings.general.releaseChannel.label') }}
                    </p>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.general.releaseChannel.hint') }}
                    </p>
                  </div>
                  <UiSelect v-model="layout.releaseChannel">
                    <UiSelectTrigger class="w-44 shrink-0">
                      <UiSelectValue />
                    </UiSelectTrigger>
                    <UiSelectContent>
                      <UiSelectItem value="stable">
                        {{ t('settings.general.releaseChannel.stable') }}
                      </UiSelectItem>
                      <UiSelectItem value="beta">
                        {{ t('settings.general.releaseChannel.beta') }}
                      </UiSelectItem>
                    </UiSelectContent>
                  </UiSelect>
                </div>

                <div class="flex items-center justify-between gap-4">
                  <div class="min-w-0">
                    <p class="text-sm font-medium">
                      {{ t('settings.about.checkUpdates') }}
                    </p>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.general.checkUpdatesHint') }}
                    </p>
                  </div>
                  <UiButton
                    variant="outline"
                    size="sm"
                    class="shrink-0"
                    icon="lucide:refresh-cw"
                    :pending="checking"
                    @click="checkForUpdates()"
                  >
                    {{ t('settings.about.checkUpdates') }}
                  </UiButton>
                </div>
              </div>
            </div>

            <div>
              <h3
                class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {{ t('settings.general.developer') }}
              </h3>
              <div class="flex items-center justify-between gap-4">
                <div class="min-w-0">
                  <p class="text-sm font-medium">
                    {{ t('settings.general.devMode.label') }}
                  </p>
                  <p class="text-xs text-muted-foreground">
                    {{ t('settings.general.devMode.hint') }}
                  </p>
                </div>
                <UiSwitch v-model="layout.devMode" class="shrink-0" />
              </div>
            </div>
          </section>

          <section v-else-if="page === 'developer'" class="w-full space-y-8">
            <div>
              <h3
                class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {{ t('settings.dev.toasts.label') }}
              </h3>
              <div class="flex items-center justify-between gap-4">
                <div class="min-w-0">
                  <p class="text-sm font-medium">
                    {{ t('settings.dev.toasts.label') }}
                  </p>
                  <p class="text-xs text-muted-foreground">
                    {{ t('settings.dev.toasts.hint') }}
                  </p>
                </div>
                <div class="flex shrink-0 gap-2">
                  <UiButton
                    v-for="tk in toastKinds"
                    :key="tk.kind"
                    :variant="tk.variant"
                    size="sm"
                    @click="fireToast(tk)"
                  >
                    {{ t(`settings.dev.${tk.kind}.label`) }}
                  </UiButton>
                </div>
              </div>
            </div>

            <div>
              <h3
                class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {{ t('settings.dev.badges.label') }}
              </h3>
              <p class="mb-3 text-xs text-muted-foreground">
                {{ t('settings.dev.badges.hint') }}
              </p>
              <div class="flex flex-wrap items-center gap-2">
                <UiBadge v-for="v in badgeKinds" :key="v" :variant="v">
                  {{ v }}
                </UiBadge>
                <UiBadge variant="warning" icon="lucide:flask-round">
                  with icon
                </UiBadge>
                <UiBadge variant="info" icon="lucide:flask-conical">
                  Experiment
                </UiBadge>
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
              <div class="space-y-4">
                <div class="flex items-center justify-between gap-4">
                  <div class="min-w-0">
                    <p class="text-sm font-medium">
                      {{ t('settings.appearance.theme.label') }}
                    </p>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.appearance.theme.hint') }}
                    </p>
                  </div>
                  <UiSelect v-model="colorMode.preference">
                    <UiSelectTrigger class="w-44 shrink-0">
                      <UiSelectValue />
                    </UiSelectTrigger>
                    <UiSelectContent>
                      <UiSelectItem
                        v-for="o in themeOptions"
                        :key="o"
                        :value="o"
                      >
                        {{ t(`settings.appearance.${o}`) }}
                      </UiSelectItem>
                    </UiSelectContent>
                  </UiSelect>
                </div>

                <div class="flex items-center justify-between gap-4">
                  <div class="min-w-0">
                    <p class="text-sm font-medium">
                      {{ t('settings.appearance.accent.label') }}
                    </p>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.appearance.accent.hint') }}
                    </p>
                  </div>
                  <div class="flex shrink-0 gap-1.5">
                    <button
                      v-for="a in accentOptions"
                      :key="a"
                      class="flex size-7 cursor-pointer items-center justify-center rounded-full border transition-transform hover:scale-110"
                      :class="
                        layout.accent === a
                          ? 'ring-2 ring-ring ring-offset-2 ring-offset-background'
                          : ''
                      "
                      :style="{ backgroundColor: accentSwatch(a) }"
                      :aria-label="a"
                      @click="layout.accent = a"
                    >
                      <NuxtIcon
                        v-if="layout.accent === a"
                        name="lucide:check"
                        class="size-3.5 text-white"
                      />
                    </button>
                  </div>
                </div>
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
                      {{ t('settings.appearance.diffMode.label') }}
                    </p>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.appearance.diffMode.hint') }}
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
                      {{ t('settings.appearance.fileView.label') }}
                    </p>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.appearance.fileView.hint') }}
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

                <div class="flex items-center justify-between gap-4">
                  <div class="min-w-0">
                    <p class="text-sm font-medium">
                      {{ t('settings.appearance.diffFont.label') }}
                    </p>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.appearance.diffFont.hint') }}
                    </p>
                  </div>
                  <UiSelect v-model.number="layout.monoScale">
                    <UiSelectTrigger class="w-44 shrink-0">
                      <UiSelectValue />
                    </UiSelectTrigger>
                    <UiSelectContent>
                      <UiSelectItem
                        v-for="f in fontScales"
                        :key="f.key"
                        :value="f.value"
                      >
                        {{ t(`settings.appearance.diffFont.${f.key}`) }}
                      </UiSelectItem>
                    </UiSelectContent>
                  </UiSelect>
                </div>
              </div>
            </div>

            <div>
              <h3
                class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {{ t('settings.appearance.graphSection') }}
              </h3>
              <div class="flex items-center justify-between gap-4">
                <div class="min-w-0">
                  <p class="text-sm font-medium">
                    {{ t('settings.appearance.shortenDependabot.label') }}
                  </p>
                  <p class="text-xs text-muted-foreground">
                    {{ t('settings.appearance.shortenDependabot.hint') }}
                  </p>
                </div>
                <UiSwitch v-model="layout.shortenDependabot" class="shrink-0" />
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
                    <NuxtIcon :name="flagFor(lang)" class="size-4 shrink-0" />
                    <UiSelectValue />
                  </span>
                </UiSelectTrigger>
                <UiSelectContent>
                  <UiSelectItem
                    v-for="l in localeOptions"
                    :key="l.code"
                    :value="l.code"
                  >
                    <NuxtIcon :name="flagFor(l.code)" class="size-4 shrink-0" />
                    {{ t(`settings.language.name.${l.code}`) }}
                  </UiSelectItem>
                </UiSelectContent>
              </UiSelect>
            </div>
          </section>

          <section v-else-if="page === 'about'" class="w-full space-y-6">
            <div class="flex items-center gap-3">
              <img src="/logo_128x128.png" alt="" class="size-10 shrink-0" />
              <div>
                <p class="text-base font-semibold">{{ t('app.name') }}</p>
                <p class="font-mono text-xs text-muted-foreground">
                  v{{ version }}
                </p>
              </div>
            </div>
            <p class="text-sm leading-relaxed text-muted-foreground">
              {{ t('settings.about.description') }}
            </p>
            <div class="flex flex-wrap gap-2">
              <UiButton
                v-for="l in aboutLinks"
                :key="l.title"
                variant="outline"
                size="sm"
                :icon="l.icon"
                @click="openExternal(l.url)"
              >
                {{ l.title }}
              </UiButton>
            </div>
          </section>
        </div>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>
