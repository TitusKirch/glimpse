<script setup lang="ts">
const open = defineModel<boolean>('open', { required: true });
const { t } = useI18n();
const settings = useSettingsStore();

// Every setting is a field of one TanStack form (validated by a single Zod
// schema); a valid change is mirrored straight to its real home. The form is
// re-seeded from the live settings each time the dialog opens, then shared with
// the per-page components that edit settings (General / Appearance / Language).
const { form, persist, reset } = useSettingsForm();
watch(open, (isOpen) => {
  if (isOpen) reset();
});

// Left navigation, grouped into sections separated by dividers. The Developer
// group (Showcase + Triggers) only appears when dev mode is on.
const navSections = computed(() => {
  const sections = [
    [
      { key: 'general', icon: 'lucide:sliders-horizontal' },
      { key: 'git', icon: 'lucide:git-branch' },
      { key: 'repository', icon: 'lucide:folder-git-2' },
      { key: 'authentication', icon: 'lucide:key-round' },
      { key: 'appearance', icon: 'lucide:palette' },
      { key: 'language', icon: 'lucide:languages' }
    ],
    [{ key: 'about', icon: 'lucide:info' }]
  ];
  if (settings.devMode) {
    sections.push([
      { key: 'showcase', icon: 'lucide:layout-grid' },
      { key: 'triggers', icon: 'lucide:zap' }
    ]);
  }
  return sections;
});
const page = ref('general');

// Leave a developer page if dev mode is switched off while one is open.
watch(
  () => settings.devMode,
  (on) => {
    if (!on && (page.value === 'showcase' || page.value === 'triggers'))
      page.value = 'general';
  }
);
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

        <!-- content: one component per page, the shared form passed to the
             setting-editing pages -->
        <div class="min-w-0 flex-1 overflow-auto p-6">
          <SettingsGeneralPage
            v-if="page === 'general'"
            :form="form"
            :persist="persist"
          />
          <SettingsGitPage v-else-if="page === 'git'" />
          <SettingsRepositoryPage v-else-if="page === 'repository'" />
          <SettingsAuthenticationPage v-else-if="page === 'authentication'" />
          <SettingsAppearancePage
            v-else-if="page === 'appearance'"
            :form="form"
            :persist="persist"
          />
          <SettingsLanguagePage
            v-else-if="page === 'language'"
            :form="form"
            :persist="persist"
          />
          <SettingsAboutPage v-else-if="page === 'about'" />
          <SettingsShowcasePage v-else-if="page === 'showcase'" />
          <SettingsTriggersPage v-else-if="page === 'triggers'" />
        </div>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>
