<script setup lang="ts">
import type {
  SettingsForm,
  SettingsPersist
} from '@/composables/useSettingsForm';

defineProps<{ form: SettingsForm; persist: SettingsPersist }>();

const { t, locale, locales } = useI18n();

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
  <section class="w-full space-y-6">
    <SettingsRow label="settings.language.label" hint="settings.language.hint">
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
                :placeholder="t('settings.language.searchLanguages.search')"
              />
              <UiCommandList>
                <UiCommandEmpty>{{ t('command.empty') }}</UiCommandEmpty>
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
                    <NuxtIcon :name="flagFor(l.code)" class="size-4 shrink-0" />
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
                  <NuxtIcon :name="flagFor(c)" class="size-4 shrink-0" />
                  <span class="truncate"
                    >{{ t(`settings.language.name.${c}`)
                    }}{{ i < field.state.value.length - 1 ? ',' : '' }}</span
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
                :placeholder="t('settings.language.searchLanguages.search')"
              />
              <UiCommandList>
                <UiCommandEmpty>{{ t('command.empty') }}</UiCommandEmpty>
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
                    <NuxtIcon :name="flagFor(l.code)" class="size-4 shrink-0" />
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
</template>
