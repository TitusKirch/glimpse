<script setup lang="ts">
import { toast } from 'vue-sonner';

const open = defineModel<boolean>('open', { required: true });
const { t, locale, locales } = useI18n();
const layout = useLayoutStore();
const { accentOptions, accentSwatch } = useAppearance();

// Every setting is a field of one TanStack form (validated by a single Zod
// schema); a valid change is mirrored straight to its real home. The form is
// re-seeded from the live settings each time the dialog opens.
const { form, persist, reset } = useSettingsForm();
watch(open, (isOpen) => {
  if (isOpen) reset();
});

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
const diffModeOptions = ['split', 'unified', 'whole'] as const;
const diffModeLabel: Record<(typeof diffModeOptions)[number], string> = {
  split: 'diff.sideBySide',
  unified: 'diff.unified',
  whole: 'diff.whole'
};
const fileViewOptions = ['list', 'tree'] as const;
// Diff font scale presets (multipliers applied via --mono-scale).
const fontScales = [
  { value: 0.85, key: 'small' },
  { value: 1, key: 'default' },
  { value: 1.15, key: 'large' },
  { value: 1.3, key: 'xlarge' }
] as const;

const { checking, checkForUpdates } = useUpdater();

// Experiment channel: the cached list + a throttled manual refresh. Fetch once
// when the user switches to the experiment channel (refresh() self-throttles).
const expRefresh = useExperiments();
const refreshingExp = ref(false);
async function refreshExperiments() {
  refreshingExp.value = true;
  try {
    await expRefresh.refresh(true);
  } catch (e) {
    toast.error(t('settings.general.experiment.refreshFailed'), {
      description: String(e)
    });
  } finally {
    refreshingExp.value = false;
  }
}
watch(
  () => layout.releaseChannel,
  (c) => {
    if (c === 'experiment') void expRefresh.refresh();
  }
);

// App version (Tauri only, "dev" in the browser); shown on the About page.
const { version } = useAppVersion();

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
// The language + search-language comboboxes are bound to the `language` and
// `searchLocales` form fields (see template); these only drive the popovers.
const langOpen = ref(false);
const searchOpen = ref(false);
const searchLocaleOptions = computed(() =>
  localeOptions.value.filter((l) => l.code !== locale.value)
);
// Toggle a code in the multi-select field's array value.
function toggledLocales({
  current,
  code
}: {
  current: string[];
  code: string;
}): string[] {
  return current.includes(code)
    ? current.filter((c) => c !== code)
    : [...current, code];
}
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
                <SettingsRow
                  label="settings.general.autoFetch.label"
                  hint="settings.general.autoFetch.hint"
                >
                  <form.Field
                    v-slot="{ field }"
                    name="autoFetch"
                    :listeners="persist('autoFetch')"
                  >
                    <UiSwitch
                      :model-value="field.state.value"
                      class="shrink-0"
                      @update:model-value="
                        (v) => field.handleChange(v as never)
                      "
                    />
                  </form.Field>
                </SettingsRow>
                <SettingsRow
                  v-if="layout.autoFetch"
                  label="settings.general.autoFetchInterval.label"
                  hint="settings.general.autoFetchInterval.hint"
                >
                  <form.Field
                    v-slot="{ field }"
                    name="autoFetchMinutes"
                    :listeners="persist('autoFetchMinutes')"
                  >
                    <UiInput
                      type="number"
                      min="1"
                      max="120"
                      class="w-24 shrink-0"
                      :model-value="field.state.value"
                      @input="
                        field.handleChange(
                          Number(($event.target as HTMLInputElement).value)
                        )
                      "
                    />
                  </form.Field>
                </SettingsRow>

                <SettingsRow
                  label="settings.general.pullStrategy.label"
                  hint="settings.general.pullStrategy.hint"
                >
                  <form.Field
                    v-slot="{ field }"
                    name="pullStrategy"
                    :listeners="persist('pullStrategy')"
                  >
                    <UiSelect
                      :model-value="field.state.value"
                      @update:model-value="
                        (v) => field.handleChange(v as never)
                      "
                    >
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
                  </form.Field>
                </SettingsRow>
              </div>
            </div>

            <div>
              <h3
                class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {{ t('settings.general.updatesSection') }}
              </h3>
              <div class="space-y-4">
                <SettingsRow
                  label="settings.general.autoUpdate.label"
                  hint="settings.general.autoUpdate.hint"
                >
                  <form.Field
                    v-slot="{ field }"
                    name="autoUpdate"
                    :listeners="persist('autoUpdate')"
                  >
                    <UiSwitch
                      :model-value="field.state.value"
                      class="shrink-0"
                      @update:model-value="
                        (v) => field.handleChange(v as never)
                      "
                    />
                  </form.Field>
                </SettingsRow>

                <SettingsRow
                  label="settings.general.releaseChannel.label"
                  hint="settings.general.releaseChannel.hint"
                >
                  <form.Field
                    v-slot="{ field }"
                    name="releaseChannel"
                    :listeners="persist('releaseChannel')"
                  >
                    <UiSelect
                      :model-value="field.state.value"
                      @update:model-value="
                        (v) => field.handleChange(v as never)
                      "
                    >
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
                        <UiSelectItem value="experiment">
                          {{ t('settings.general.releaseChannel.experiment') }}
                        </UiSelectItem>
                      </UiSelectContent>
                    </UiSelect>
                  </form.Field>
                </SettingsRow>

                <!-- experiment picker — only on the experiment channel -->
                <template v-if="layout.releaseChannel === 'experiment'">
                  <!-- has experiments: the picker + throttled refresh -->
                  <SettingsRow
                    v-if="layout.experiments.length"
                    label="settings.general.experiment.label"
                    hint="settings.general.experiment.hint"
                  >
                    <div class="flex shrink-0 items-center gap-2">
                      <form.Field
                        v-slot="{ field }"
                        name="selectedExperiment"
                        :listeners="persist('selectedExperiment')"
                      >
                        <UiSelect
                          :model-value="field.state.value"
                          @update:model-value="
                            (v) => field.handleChange(v as never)
                          "
                        >
                          <UiSelectTrigger class="w-44">
                            <UiSelectValue
                              :placeholder="
                                t('settings.general.experiment.none')
                              "
                            />
                          </UiSelectTrigger>
                          <UiSelectContent>
                            <UiSelectItem
                              v-for="e in layout.experiments"
                              :key="e"
                              :value="e"
                            >
                              {{ e }}
                            </UiSelectItem>
                          </UiSelectContent>
                        </UiSelect>
                      </form.Field>
                      <!-- a visible cooldown counter (the dialog is portalled
                           outside the TooltipProvider, and a disabled button
                           can't be hovered for a tooltip anyway) -->
                      <span
                        v-if="!expRefresh.canRefresh.value"
                        class="text-xs text-muted-foreground tabular-nums"
                      >
                        {{ expRefresh.cooldown.value }}s
                      </span>
                      <UiButton
                        variant="outline"
                        size="icon"
                        icon="lucide:refresh-cw"
                        :aria-label="t('settings.general.experiment.refresh')"
                        :disabled="!expRefresh.canRefresh.value"
                        :pending="refreshingExp"
                        @click="refreshExperiments"
                      />
                    </div>
                  </SettingsRow>

                  <!-- none yet: info box with a search button -->
                  <UiAlert
                    v-else
                    variant="info"
                    class="flex items-center justify-between gap-3"
                  >
                    <div class="flex min-w-0 items-center gap-2.5">
                      <NuxtIcon
                        name="lucide:flask-conical"
                        mode="svg"
                        class="size-4 shrink-0"
                      />
                      <p class="text-sm">
                        {{ t('settings.general.experiment.empty') }}
                      </p>
                    </div>
                    <UiButton
                      variant="outline"
                      size="sm"
                      class="shrink-0"
                      :disabled="!expRefresh.canRefresh.value"
                      :pending="refreshingExp"
                      @click="refreshExperiments"
                    >
                      <template #leading="{ pending }">
                        <NuxtIcon
                          v-if="pending"
                          name="lucide:loader-circle"
                          class="size-3.5 animate-spin"
                        />
                        <span
                          v-else-if="!expRefresh.canRefresh.value"
                          class="text-xs tabular-nums"
                        >
                          {{ expRefresh.cooldown.value }}
                        </span>
                        <NuxtIcon
                          v-else
                          name="lucide:refresh-cw"
                          class="size-3.5"
                        />
                      </template>
                      {{ t('settings.general.experiment.search') }}
                    </UiButton>
                  </UiAlert>
                </template>

                <div class="flex items-center justify-between gap-4">
                  <div class="min-w-0">
                    <p class="text-sm font-medium">
                      {{
                        layout.releaseChannel === 'experiment'
                          ? t('settings.general.experiment.switch')
                          : t('settings.about.checkUpdates')
                      }}
                    </p>
                    <p class="text-xs text-muted-foreground">
                      {{
                        layout.releaseChannel === 'experiment'
                          ? t('settings.general.experiment.switchHint')
                          : t('settings.general.checkUpdatesHint')
                      }}
                    </p>
                  </div>
                  <UiButton
                    variant="outline"
                    size="sm"
                    class="shrink-0"
                    icon="lucide:refresh-cw"
                    :pending="checking"
                    :disabled="
                      layout.releaseChannel === 'experiment' &&
                      !layout.selectedExperiment
                    "
                    @click="checkForUpdates()"
                  >
                    {{
                      layout.releaseChannel === 'experiment'
                        ? t('settings.general.experiment.install')
                        : t('settings.about.checkUpdates')
                    }}
                  </UiButton>
                </div>
              </div>
            </div>

            <div>
              <h3
                class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {{ t('settings.general.recentSection') }}
              </h3>
              <div class="space-y-4">
                <SettingsRow
                  label="settings.general.recentReposMax.label"
                  hint="settings.general.recentReposMax.hint"
                >
                  <form.Field
                    v-slot="{ field }"
                    name="recentReposMax"
                    :listeners="persist('recentReposMax')"
                  >
                    <UiInput
                      type="number"
                      min="1"
                      max="50"
                      class="w-24 shrink-0"
                      :model-value="field.state.value"
                      @input="
                        field.handleChange(
                          Number(($event.target as HTMLInputElement).value)
                        )
                      "
                    />
                  </form.Field>
                </SettingsRow>
                <SettingsRow
                  label="settings.general.recentReposOnPage.label"
                  hint="settings.general.recentReposOnPage.hint"
                >
                  <form.Field
                    v-slot="{ field }"
                    name="recentReposOnPage"
                    :listeners="persist('recentReposOnPage')"
                  >
                    <UiInput
                      type="number"
                      min="0"
                      :max="layout.recentReposMax"
                      class="w-24 shrink-0"
                      :model-value="field.state.value"
                      @input="
                        field.handleChange(
                          Number(($event.target as HTMLInputElement).value)
                        )
                      "
                    />
                  </form.Field>
                </SettingsRow>
                <SettingsRow
                  label="settings.general.recentReposInSearch.label"
                  hint="settings.general.recentReposInSearch.hint"
                >
                  <form.Field
                    v-slot="{ field }"
                    name="recentReposInSearch"
                    :listeners="persist('recentReposInSearch')"
                  >
                    <UiInput
                      type="number"
                      min="0"
                      :max="layout.recentReposMax"
                      class="w-24 shrink-0"
                      :model-value="field.state.value"
                      @input="
                        field.handleChange(
                          Number(($event.target as HTMLInputElement).value)
                        )
                      "
                    />
                  </form.Field>
                </SettingsRow>
                <SettingsRow
                  label="settings.general.recentActionsMax.label"
                  hint="settings.general.recentActionsMax.hint"
                >
                  <form.Field
                    v-slot="{ field }"
                    name="recentActionsMax"
                    :listeners="persist('recentActionsMax')"
                  >
                    <UiInput
                      type="number"
                      min="0"
                      max="50"
                      class="w-24 shrink-0"
                      :model-value="field.state.value"
                      @input="
                        field.handleChange(
                          Number(($event.target as HTMLInputElement).value)
                        )
                      "
                    />
                  </form.Field>
                </SettingsRow>
                <SettingsRow
                  label="settings.general.recentActionsInSearch.label"
                  hint="settings.general.recentActionsInSearch.hint"
                >
                  <form.Field
                    v-slot="{ field }"
                    name="recentActionsInSearch"
                    :listeners="persist('recentActionsInSearch')"
                  >
                    <UiInput
                      type="number"
                      min="0"
                      :max="layout.recentActionsMax"
                      class="w-24 shrink-0"
                      :model-value="field.state.value"
                      @input="
                        field.handleChange(
                          Number(($event.target as HTMLInputElement).value)
                        )
                      "
                    />
                  </form.Field>
                </SettingsRow>
              </div>
            </div>

            <div>
              <h3
                class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {{ t('settings.general.developer') }}
              </h3>
              <SettingsRow
                label="settings.general.devMode.label"
                hint="settings.general.devMode.hint"
              >
                <form.Field
                  v-slot="{ field }"
                  name="devMode"
                  :listeners="persist('devMode')"
                >
                  <UiSwitch
                    :model-value="field.state.value"
                    class="shrink-0"
                    @update:model-value="(v) => field.handleChange(v as never)"
                  />
                </form.Field>
              </SettingsRow>
            </div>
          </section>

          <section v-else-if="page === 'developer'" class="w-full space-y-8">
            <div>
              <h3
                class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {{ t('settings.dev.toasts.label') }}
              </h3>
              <SettingsRow
                label="settings.dev.toasts.label"
                hint="settings.dev.toasts.hint"
              >
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
              </SettingsRow>
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
                <UiBadge variant="warning" icon="lucide:rocket">
                  with icon
                </UiBadge>
                <UiBadge variant="destructive" icon="lucide:flask-conical">
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
                <SettingsRow
                  label="settings.appearance.theme.label"
                  hint="settings.appearance.theme.hint"
                >
                  <form.Field
                    v-slot="{ field }"
                    name="theme"
                    :listeners="persist('theme')"
                  >
                    <UiSelect
                      :model-value="field.state.value"
                      @update:model-value="
                        (v) => field.handleChange(v as never)
                      "
                    >
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
                  </form.Field>
                </SettingsRow>

                <SettingsRow
                  label="settings.appearance.accent.label"
                  hint="settings.appearance.accent.hint"
                >
                  <form.Field
                    v-slot="{ field }"
                    name="accent"
                    :listeners="persist('accent')"
                  >
                    <div class="flex shrink-0 gap-1.5">
                      <button
                        v-for="a in accentOptions"
                        :key="a"
                        class="flex size-7 cursor-pointer items-center justify-center rounded-full border transition-transform hover:scale-110"
                        :class="
                          field.state.value === a
                            ? 'ring-2 ring-ring ring-offset-2 ring-offset-background'
                            : ''
                        "
                        :style="{ backgroundColor: accentSwatch(a) }"
                        :aria-label="a"
                        @click="field.handleChange(a)"
                      >
                        <NuxtIcon
                          v-if="field.state.value === a"
                          name="lucide:check"
                          class="size-3.5 text-white"
                        />
                      </button>
                    </div>
                  </form.Field>
                </SettingsRow>
              </div>
            </div>

            <div>
              <h3
                class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {{ t('settings.appearance.diffSection') }}
              </h3>
              <div class="space-y-4">
                <SettingsRow
                  label="settings.appearance.diffMode.label"
                  hint="settings.appearance.diffMode.hint"
                >
                  <form.Field
                    v-slot="{ field }"
                    name="diffMode"
                    :listeners="persist('diffMode')"
                  >
                    <UiSelect
                      :model-value="field.state.value"
                      @update:model-value="
                        (v) => field.handleChange(v as never)
                      "
                    >
                      <UiSelectTrigger class="w-44 shrink-0">
                        <UiSelectValue />
                      </UiSelectTrigger>
                      <UiSelectContent>
                        <UiSelectItem
                          v-for="m in diffModeOptions"
                          :key="m"
                          :value="m"
                        >
                          {{ t(diffModeLabel[m]) }}
                        </UiSelectItem>
                      </UiSelectContent>
                    </UiSelect>
                  </form.Field>
                </SettingsRow>

                <SettingsRow
                  label="settings.appearance.fileView.label"
                  hint="settings.appearance.fileView.hint"
                >
                  <form.Field
                    v-slot="{ field }"
                    name="fileView"
                    :listeners="persist('fileView')"
                  >
                    <UiSelect
                      :model-value="field.state.value"
                      @update:model-value="
                        (v) => field.handleChange(v as never)
                      "
                    >
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
                  </form.Field>
                </SettingsRow>

                <SettingsRow
                  label="settings.appearance.diffFont.label"
                  hint="settings.appearance.diffFont.hint"
                >
                  <form.Field
                    v-slot="{ field }"
                    name="monoScale"
                    :listeners="persist('monoScale')"
                  >
                    <UiSelect
                      :model-value="field.state.value"
                      @update:model-value="(v) => field.handleChange(Number(v))"
                    >
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
                  </form.Field>
                </SettingsRow>
              </div>
            </div>

            <div>
              <h3
                class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {{ t('settings.appearance.sidebarSection') }}
              </h3>
              <div class="space-y-4">
                <SettingsRow
                  label="settings.appearance.sidebarResizable.label"
                  hint="settings.appearance.sidebarResizable.hint"
                >
                  <form.Field
                    v-slot="{ field }"
                    name="sidebarResizable"
                    :listeners="persist('sidebarResizable')"
                  >
                    <UiSwitch
                      :model-value="field.state.value"
                      class="shrink-0"
                      @update:model-value="
                        (v) => field.handleChange(v as never)
                      "
                    />
                  </form.Field>
                </SettingsRow>
                <SettingsRow
                  label="settings.appearance.sidebarWidth.label"
                  hint="settings.appearance.sidebarWidth.hint"
                >
                  <form.Field
                    v-slot="{ field }"
                    name="sidebarWidth"
                    :listeners="persist('sidebarWidth')"
                  >
                    <UiInput
                      type="number"
                      min="192"
                      max="512"
                      step="8"
                      class="w-24 shrink-0"
                      :model-value="field.state.value"
                      @input="
                        field.handleChange(
                          Number(($event.target as HTMLInputElement).value)
                        )
                      "
                    />
                  </form.Field>
                </SettingsRow>
              </div>
            </div>

            <div>
              <h3
                class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {{ t('settings.appearance.graphSection') }}
              </h3>
              <SettingsRow
                label="settings.appearance.shortenDependabot.label"
                hint="settings.appearance.shortenDependabot.hint"
              >
                <form.Field
                  v-slot="{ field }"
                  name="shortenDependabot"
                  :listeners="persist('shortenDependabot')"
                >
                  <UiSwitch
                    :model-value="field.state.value"
                    class="shrink-0"
                    @update:model-value="(v) => field.handleChange(v as never)"
                  />
                </form.Field>
              </SettingsRow>
            </div>
          </section>

          <section v-else-if="page === 'language'" class="w-full space-y-6">
            <SettingsRow
              label="settings.language.label"
              hint="settings.language.hint"
            >
              <form.Field
                v-slot="{ field }"
                name="language"
                :listeners="persist('language')"
              >
                <UiPopover v-model:open="langOpen">
                  <UiPopoverTrigger as-child>
                    <UiButton
                      variant="outline"
                      role="combobox"
                      :aria-expanded="langOpen"
                      class="w-44 shrink-0 justify-between font-normal"
                    >
                      <span class="flex items-center gap-2 truncate">
                        <NuxtIcon
                          :name="flagFor(field.state.value)"
                          class="size-4 shrink-0"
                        />
                        <span class="truncate">{{
                          t(`settings.language.name.${field.state.value}`)
                        }}</span>
                      </span>
                      <NuxtIcon
                        name="lucide:chevrons-up-down"
                        class="size-4 shrink-0 opacity-50"
                      />
                    </UiButton>
                  </UiPopoverTrigger>
                  <UiPopoverContent align="end" class="w-56 p-0">
                    <UiCommand>
                      <UiCommandInput
                        :placeholder="
                          t('settings.language.searchLanguages.search')
                        "
                      />
                      <UiCommandList>
                        <UiCommandEmpty>{{
                          t('command.empty')
                        }}</UiCommandEmpty>
                        <UiCommandGroup>
                          <UiCommandItem
                            v-for="l in localeOptions"
                            :key="l.code"
                            :value="l.code"
                            @select="
                              field.handleChange(l.code);
                              langOpen = false;
                            "
                          >
                            <NuxtIcon
                              :name="flagFor(l.code)"
                              class="size-4 shrink-0"
                            />
                            {{ t(`settings.language.name.${l.code}`) }}
                            <NuxtIcon
                              name="lucide:check"
                              class="ml-auto size-4 shrink-0"
                              :class="
                                field.state.value === l.code
                                  ? 'opacity-100'
                                  : 'opacity-0'
                              "
                            />
                          </UiCommandItem>
                        </UiCommandGroup>
                      </UiCommandList>
                    </UiCommand>
                  </UiPopoverContent>
                </UiPopover>
              </form.Field>
            </SettingsRow>

            <SettingsRow
              label="settings.language.searchLanguages.label"
              hint="settings.language.searchLanguages.hint"
            >
              <form.Field
                v-slot="{ field }"
                name="searchLocales"
                :listeners="persist('searchLocales')"
              >
                <UiPopover v-model:open="searchOpen">
                  <UiPopoverTrigger as-child>
                    <UiButton
                      variant="outline"
                      role="combobox"
                      :aria-expanded="searchOpen"
                      class="w-44 shrink-0 justify-between font-normal"
                    >
                      <span
                        v-if="field.state.value.length"
                        class="flex items-center gap-1.5 truncate"
                      >
                        <span
                          v-for="(c, i) in field.state.value"
                          :key="c"
                          class="flex items-center gap-1"
                        >
                          <NuxtIcon
                            :name="flagFor(c)"
                            class="size-4 shrink-0"
                          />
                          <span class="truncate"
                            >{{ t(`settings.language.name.${c}`)
                            }}{{
                              i < field.state.value.length - 1 ? ',' : ''
                            }}</span
                          >
                        </span>
                      </span>
                      <span v-else class="truncate text-muted-foreground">{{
                        t('settings.language.searchLanguages.placeholder')
                      }}</span>
                      <NuxtIcon
                        name="lucide:chevrons-up-down"
                        class="size-4 shrink-0 opacity-50"
                      />
                    </UiButton>
                  </UiPopoverTrigger>
                  <UiPopoverContent align="end" class="w-56 p-0">
                    <UiCommand>
                      <UiCommandInput
                        :placeholder="
                          t('settings.language.searchLanguages.search')
                        "
                      />
                      <UiCommandList>
                        <UiCommandEmpty>{{
                          t('command.empty')
                        }}</UiCommandEmpty>
                        <UiCommandGroup>
                          <UiCommandItem
                            v-for="l in searchLocaleOptions"
                            :key="l.code"
                            :value="l.code"
                            @select="
                              field.handleChange(
                                toggledLocales({
                                  current: field.state.value,
                                  code: l.code
                                })
                              )
                            "
                          >
                            <NuxtIcon
                              :name="flagFor(l.code)"
                              class="size-4 shrink-0"
                            />
                            {{ t(`settings.language.name.${l.code}`) }}
                            <NuxtIcon
                              name="lucide:check"
                              class="ml-auto size-4 shrink-0"
                              :class="
                                field.state.value.includes(l.code)
                                  ? 'opacity-100'
                                  : 'opacity-0'
                              "
                            />
                          </UiCommandItem>
                        </UiCommandGroup>
                      </UiCommandList>
                    </UiCommand>
                  </UiPopoverContent>
                </UiPopover>
              </form.Field>
            </SettingsRow>
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
