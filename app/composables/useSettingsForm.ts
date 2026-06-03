// One TanStack form + Zod schema for the whole settings dialog. Every setting is
// a field; a field's validated value is mirrored straight to its real home
// (layout store, colour mode, or i18n locale) so the change still applies live.
// A single form — not one per input — keeps validation in one schema without the
// per-input overhead.
import { useForm } from '@tanstack/vue-form';
import { z } from 'zod';
import { toast } from 'vue-sonner';

export function useSettingsForm() {
  const layout = useLayoutStore();
  const colorMode = useColorMode();
  const { locale, setLocale, t } = useI18n();

  const schema = z.object({
    theme: z.enum(['system', 'light', 'dark']),
    language: z.string().min(1),
    searchLocales: z.array(z.string()),
    pullStrategy: z.enum(['merge', 'rebase', 'ff-only']),
    releaseChannel: z.enum(['stable', 'beta', 'experiment']),
    selectedExperiment: z.string(),
    autoFetch: z.boolean(),
    autoFetchMinutes: z.number().int().min(1).max(120),
    autoUpdate: z.boolean(),
    recentReposMax: z.number().int().min(1).max(50),
    recentReposOnPage: z.number().int().min(0).max(50),
    recentReposInSearch: z.number().int().min(0).max(50),
    recentActionsMax: z.number().int().min(0).max(50),
    recentActionsInSearch: z.number().int().min(0).max(50),
    sidebarResizable: z.boolean(),
    sidebarWidth: z.number().int().min(192).max(512),
    sidebarEditMode: z.boolean(),
    diffMode: z.enum(['split', 'unified', 'whole']),
    fileView: z.enum(['list', 'tree']),
    monoScale: z.number(),
    accent: z.enum(['default', 'blue', 'violet', 'green', 'amber', 'rose']),
    shortenDependabot: z.boolean(),
    devMode: z.boolean(),
    experimentsEnabled: z.boolean()
  });
  type SettingsValues = z.infer<typeof schema>;

  // The current settings, read from each value's real home.
  function snapshot(): SettingsValues {
    return {
      theme: colorMode.preference as SettingsValues['theme'],
      language: locale.value,
      searchLocales: layout.searchLocales ?? [],
      pullStrategy: layout.pullStrategy,
      releaseChannel: layout.releaseChannel,
      selectedExperiment: layout.selectedExperiment,
      autoFetch: layout.autoFetch,
      autoFetchMinutes: layout.autoFetchMinutes,
      autoUpdate: layout.autoUpdate,
      recentReposMax: layout.recentReposMax,
      recentReposOnPage: layout.recentReposOnPage,
      recentReposInSearch: layout.recentReposInSearch,
      recentActionsMax: layout.recentActionsMax,
      recentActionsInSearch: layout.recentActionsInSearch,
      sidebarResizable: layout.sidebarResizable,
      sidebarWidth: layout.sidebarWidth,
      sidebarEditMode: layout.sidebarEditMode,
      diffMode: layout.diffMode,
      fileView: layout.fileView,
      monoScale: layout.monoScale,
      accent: layout.accent,
      shortenDependabot: layout.shortenDependabot,
      devMode: layout.devMode,
      experimentsEnabled: layout.experimentsEnabled
    };
  }

  const form = useForm({
    defaultValues: snapshot(),
    validators: { onChange: schema }
  });

  // Mirror one validated field value to its real home (change-guarded so we
  // don't fire reactive side effects or i18n loads for an unchanged value).
  function apply({
    name,
    value
  }: {
    name: keyof SettingsValues;
    value: unknown;
  }) {
    if (name === 'theme') {
      if (colorMode.preference !== value)
        colorMode.preference = value as SettingsValues['theme'];
      return;
    }
    if (name === 'language') {
      if (locale.value !== value) void setLocale(value as typeof locale.value);
      // The active display language can't also be an *additional* search
      // language; drop it from that list (and the field) if it's in there.
      const langs = form.getFieldValue('searchLocales');
      if (langs.includes(value as string)) {
        const pruned = langs.filter((c) => c !== value);
        form.setFieldValue('searchLocales', pruned);
        layout.setSearchLocales(pruned);
      }
      return;
    }
    if (name === 'searchLocales') {
      layout.setSearchLocales(value as string[]);
      return;
    }
    const store = layout as unknown as Record<string, unknown>;
    if (store[name] !== value) store[name] = value;
    // Toggling either gate can strip access to the Experiment channel; drop it
    // back to Beta, keep the dialog's channel field in sync, and tell the user.
    if (name === 'devMode' || name === 'experimentsEnabled') {
      if (layout.normalizeChannel()) {
        form.setFieldValue('releaseChannel', layout.releaseChannel);
        toast.info(t('settings.general.channelFallback.title'), {
          description: t('settings.general.channelFallback.description', {
            channel: t(
              `settings.general.releaseChannel.${layout.releaseChannel}`
            )
          })
        });
      }
    }
  }

  // Per-field listener: persist only when the field itself is valid, so an
  // out-of-range number is shown as an error without overwriting the setting.
  function persist(name: keyof SettingsValues) {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onChange: ({ fieldApi }: { fieldApi: any }) => {
        if (fieldApi.state.meta.errors.length === 0)
          apply({ name, value: fieldApi.state.value });
      }
    };
  }

  // Re-seed the form from the live settings (call when the dialog opens).
  function reset() {
    form.reset(snapshot());
  }

  return { form, persist, reset };
}

// The shared form + per-field persist listener factory, as handed to the
// per-page settings components (Dialog.vue owns the single instance).
export type SettingsForm = ReturnType<typeof useSettingsForm>['form'];
export type SettingsPersist = ReturnType<typeof useSettingsForm>['persist'];
