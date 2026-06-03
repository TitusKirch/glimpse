<script setup lang="ts">
import type {
  SettingsForm,
  SettingsPersist
} from '@/composables/useSettingsForm';
import { toast } from 'vue-sonner';

defineProps<{ form: SettingsForm; persist: SettingsPersist }>();

const { t } = useI18n();
const settings = useSettingsStore();

// Install the `glimpse` command-line launcher onto PATH (desktop only — the row
// is hidden in the browser demo). Idempotent; re-running just refreshes it.
async function installCli() {
  try {
    const path = await gitClient.installCli();
    toast.success(t('settings.general.cli.installed', { path }), {
      description: t('settings.general.cli.restartHint')
    });
  } catch (err) {
    toast.error(t('settings.general.cli.failed'), {
      description: typeof err === 'string' ? err : String(err)
    });
  }
}

const { checking, checkForUpdates } = useUpdater();

// Experiment channel: the cached list + a throttled manual refresh. Fetch once
// when the user switches to the experiment channel (refresh() self-throttles).
const expRefresh = useExperiments();
const refreshingExp = ref(false);
// False until the first experiment fetch settles, so the experiment section
// shows a "checking…" row instead of flashing the empty state before results
// arrive (e.g. right after switching to the experiment channel).
const experimentsChecked = ref(settings.experiments.length > 0);

async function loadExperiments(force = false) {
  refreshingExp.value = true;
  try {
    await expRefresh.refresh(force);
  } catch (e) {
    toast.error(t('settings.general.experiment.refreshFailed'), {
      description: String(e)
    });
  } finally {
    refreshingExp.value = false;
    experimentsChecked.value = true;
  }
}
function refreshExperiments() {
  void loadExperiments(true);
}
watch(
  () => settings.releaseChannel,
  (c) => {
    if (c === 'experiment') {
      experimentsChecked.value = settings.experiments.length > 0;
      void loadExperiments();
    }
  }
);
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

    <!-- Command-line launcher install — desktop only (no PATH in the
         browser demo). -->
    <div v-if="isTauri()">
      <h3
        class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {{ t('settings.general.cliSection') }}
      </h3>
      <div class="space-y-4">
        <SettingsRow
          label="settings.general.cli.label"
          hint="settings.general.cli.hint"
        >
          <UiButton
            variant="outline"
            size="sm"
            icon="lucide:terminal"
            class="shrink-0"
            @click="installCli"
          >
            {{ t('settings.general.cli.install') }}
          </UiButton>
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
              @update:model-value="(v) => field.handleChange(v as never)"
            />
          </form.Field>
        </SettingsRow>

        <!-- Release channel: Stable and Beta are always selectable; the
             Experiment option appears only with the experiments opt-in. -->
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
              @update:model-value="(v) => field.handleChange(v as never)"
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
                <UiSelectItem
                  v-if="settings.get('experimentsEnabled')"
                  value="experiment"
                >
                  {{ t('settings.general.releaseChannel.experiment') }}
                </UiSelectItem>
              </UiSelectContent>
            </UiSelect>
          </form.Field>
        </SettingsRow>

        <!-- experiment picker — only on the experiment channel -->
        <template v-if="settings.releaseChannel === 'experiment'">
          <!-- has experiments: the picker; refreshing the list is an
               inline link in the hint, with its cooldown counter -->
          <SettingsRow
            v-if="settings.experiments.length"
            label="settings.general.experiment.label"
            hint="settings.general.experiment.hint"
          >
            <template #hint>
              {{ ' ' }}
              <button
                type="button"
                class="cursor-pointer underline underline-offset-2 transition-colors hover:text-foreground disabled:cursor-default disabled:no-underline disabled:opacity-70"
                :disabled="!expRefresh.canRefresh.value || refreshingExp"
                @click="refreshExperiments"
              >
                {{
                  refreshingExp
                    ? t('settings.general.experiment.refreshing')
                    : expRefresh.canRefresh.value
                      ? t('settings.general.experiment.refresh')
                      : t('settings.general.experiment.refreshIn', {
                          n: expRefresh.cooldown.value
                        })
                }}
              </button>
            </template>
            <form.Field
              v-slot="{ field }"
              name="selectedExperiment"
              :listeners="persist('selectedExperiment')"
            >
              <UiSelect
                :model-value="field.state.value"
                @update:model-value="(v) => field.handleChange(v as never)"
              >
                <UiSelectTrigger class="w-44 shrink-0">
                  <UiSelectValue
                    :placeholder="t('settings.general.experiment.none')"
                  />
                </UiSelectTrigger>
                <UiSelectContent>
                  <UiSelectItem
                    v-for="e in settings.experiments"
                    :key="e"
                    :value="e"
                  >
                    {{ e }}
                  </UiSelectItem>
                </UiSelectContent>
              </UiSelect>
            </form.Field>
          </SettingsRow>

          <!-- still checking: don't flash the empty state first -->
          <div
            v-else-if="!experimentsChecked || refreshingExp"
            class="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <NuxtIcon name="lucide:loader-circle" class="size-4 animate-spin" />
            {{ t('settings.general.experiment.checking') }}
          </div>

          <!-- none found: info box with a search button -->
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
                <NuxtIcon v-else name="lucide:refresh-cw" class="size-3.5" />
              </template>
              {{ t('settings.general.experiment.search') }}
            </UiButton>
          </UiAlert>
        </template>

        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0">
            <p class="text-sm font-medium">
              {{
                settings.releaseChannel === 'experiment'
                  ? t('settings.general.experiment.switch')
                  : t('settings.about.checkUpdates')
              }}
            </p>
            <p class="text-xs text-muted-foreground">
              {{
                settings.releaseChannel === 'experiment'
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
              settings.releaseChannel === 'experiment' &&
              !settings.selectedExperiment
            "
            @click="checkForUpdates()"
          >
            {{
              settings.releaseChannel === 'experiment'
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
              :max="settings.recentReposMax"
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
              :max="settings.recentReposMax"
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
              :max="settings.recentActionsMax"
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
      <div class="space-y-4">
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

        <!-- Experiments opt-in: only once developer mode is on. Off by
             default; gates the Experiment release channel. -->
        <SettingsRow
          v-if="settings.devMode"
          label="settings.general.experimentsOptIn.label"
          hint="settings.general.experimentsOptIn.hint"
        >
          <form.Field
            v-slot="{ field }"
            name="experimentsEnabled"
            :listeners="persist('experimentsEnabled')"
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
  </section>
</template>
