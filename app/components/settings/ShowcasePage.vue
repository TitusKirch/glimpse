<script setup lang="ts">
const { t } = useI18n();

// Showcase page: the design-system reference for the semantic colours. All
// three components that carry them are here, so the two treatments — the
// accent on a panel, the fill on a chip or a button — stand side by side
// rather than having to be reconstructed from three `index.ts` files.
const badgeKinds = [
  'default',
  'secondary',
  'outline',
  'info',
  'success',
  'warning',
  'destructive'
] as const;

const alertKinds = [
  'default',
  'info',
  'success',
  'warning',
  'destructive'
] as const;

// shadcn's own set — the semantic colours other than `destructive` are
// deliberately not button variants.
const buttonKinds = [
  'default',
  'secondary',
  'outline',
  'ghost',
  'link',
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

    <div>
      <h3
        class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {{ t('settings.showcase.alerts.label') }}
      </h3>
      <p class="mb-3 text-xs text-muted-foreground">
        {{ t('settings.showcase.alerts.hint') }}
      </p>
      <div class="space-y-2">
        <UiAlert v-for="v in alertKinds" :key="v" :variant="v">
          <UiAlertTitle>{{ v }}</UiAlertTitle>
          <UiAlertDescription>
            {{ t('settings.showcase.alerts.body') }}
          </UiAlertDescription>
        </UiAlert>
      </div>
    </div>

    <div>
      <h3
        class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {{ t('settings.showcase.buttons.label') }}
      </h3>
      <p class="mb-3 text-xs text-muted-foreground">
        {{ t('settings.showcase.buttons.hint') }}
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <UiButton v-for="v in buttonKinds" :key="v" :variant="v" size="sm">
          {{ v }}
        </UiButton>
      </div>
    </div>
  </section>
</template>
