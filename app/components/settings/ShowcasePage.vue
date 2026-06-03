<script setup lang="ts">
const { t } = useI18n();

// Showcase page: every badge variant at a glance (the design-system reference).
const badgeKinds = [
  'default',
  'secondary',
  'outline',
  'info',
  'success',
  'warning',
  'destructive'
] as const;
</script>

<template>
  <!-- Showcase: a visual reference of shared building blocks. -->
  <section class="w-full space-y-8">
    <div>
      <h3
        class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {{ t('settings.showcase.badges.label') }}
      </h3>
      <p class="mb-3 text-xs text-muted-foreground">
        {{ t('settings.showcase.badges.hint') }}
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <!-- every variant -->
        <UiBadge v-for="v in badgeKinds" :key="v" :variant="v">
          {{ v }}
        </UiBadge>
        <!-- the real beta / experiment badges (as shown in the sidebar) -->
        <UiBadge variant="warning" icon="lucide:rocket">
          {{ t('settings.showcase.badges.beta') }}
        </UiBadge>
        <UiBadge variant="destructive" icon="lucide:flask-conical">
          {{ t('settings.showcase.badges.experiment') }}
        </UiBadge>
        <!-- a plain "with icon" example (neutral icon + tint) -->
        <UiBadge variant="info" icon="lucide:star">
          {{ t('settings.showcase.badges.withIcon') }}
        </UiBadge>
      </div>
    </div>
  </section>
</template>
