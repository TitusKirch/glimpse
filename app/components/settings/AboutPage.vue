<script setup lang="ts">
const { t } = useI18n();

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
</script>

<template>
  <section class="w-full space-y-6">
    <div class="flex items-center gap-3">
      <img src="/logo_128x128.png" alt="" class="size-10 shrink-0" />
      <div>
        <p class="text-base font-semibold">{{ t('app.name') }}</p>
        <p class="font-mono text-xs text-muted-foreground">v{{ version }}</p>
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
</template>
