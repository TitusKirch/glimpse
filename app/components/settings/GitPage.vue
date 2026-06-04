<script setup lang="ts">
import type {
  SettingsForm,
  SettingsPersist
} from '@/composables/useSettingsForm';

defineProps<{ form: SettingsForm; persist: SettingsPersist }>();

const { t } = useI18n();
const settings = useSettingsStore();
</script>

<template>
  <section class="w-full space-y-8">
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
              @update:model-value="(v) => field.handleChange(v as never)"
            />
          </form.Field>
        </SettingsRow>
        <SettingsRow
          v-if="settings.autoFetch"
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
              @update:model-value="(v) => field.handleChange(v as never)"
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
                <UiSelectItem value="ff-only">
                  {{ t('settings.general.pullStrategy.ffOnly') }}
                </UiSelectItem>
              </UiSelectContent>
            </UiSelect>
          </form.Field>
        </SettingsRow>
      </div>
    </div>

    <SettingsGitIdentity />
    <SettingsGitSigning />
    <SettingsGitTarget />
    <SettingsSshCredentials />
  </section>
</template>
