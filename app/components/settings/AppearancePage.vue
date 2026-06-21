<script setup lang="ts">
import type {
  SettingsForm,
  SettingsPersist
} from '@/composables/useSettingsForm';

defineProps<{ form: SettingsForm; persist: SettingsPersist }>();

const { t } = useI18n();
const { accentOptions, accentSwatch } = useAppearance();

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
</script>

<template>
  <section class="w-full space-y-8">
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
              @update:model-value="(v) => field.handleChange(v as never)"
            >
              <UiSelectTrigger class="w-44 shrink-0">
                <UiSelectValue />
              </UiSelectTrigger>
              <UiSelectContent>
                <UiSelectItem v-for="o in themeOptions" :key="o" :value="o">
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
              @update:model-value="(v) => field.handleChange(v as never)"
            >
              <UiSelectTrigger class="w-44 shrink-0">
                <UiSelectValue />
              </UiSelectTrigger>
              <UiSelectContent>
                <UiSelectItem v-for="m in diffModeOptions" :key="m" :value="m">
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
              @update:model-value="(v) => field.handleChange(v as never)"
            >
              <UiSelectTrigger class="w-44 shrink-0">
                <UiSelectValue />
              </UiSelectTrigger>
              <UiSelectContent>
                <UiSelectItem v-for="v in fileViewOptions" :key="v" :value="v">
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
          label="settings.appearance.sidebarEdit.label"
          hint="settings.appearance.sidebarEdit.hint"
        >
          <form.Field
            v-slot="{ field }"
            name="sidebarEditMode"
            :listeners="persist('sidebarEditMode')"
          >
            <UiSwitch
              :model-value="field.state.value"
              class="shrink-0"
              @update:model-value="(v) => field.handleChange(v as never)"
            />
          </form.Field>
        </SettingsRow>
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
              @update:model-value="(v) => field.handleChange(v as never)"
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
        <SettingsRow
          label="settings.appearance.hideEmptySections.label"
          hint="settings.appearance.hideEmptySections.hint"
        >
          <form.Field
            v-slot="{ field }"
            name="hideEmptySidebarSections"
            :listeners="persist('hideEmptySidebarSections')"
          >
            <UiSwitch
              :model-value="field.state.value"
              class="shrink-0"
              @update:model-value="(v) => field.handleChange(v as never)"
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
</template>
