<script setup lang="ts">
// Create a tag: name + optional message (annotated) + optional signing. A
// message makes it annotated; signing requires a message. Mounted once in
// app.vue. Opened via useTagCreate (commit context menu / sidebar "new tag").
const { open, hash, hide } = useTagCreate();
const repo = useRepoStore();
const { t } = useI18n();

const name = ref('');
const message = ref('');
const sign = ref(false);

watch(open, (isOpen) => {
  if (!isOpen) return;
  name.value = '';
  message.value = '';
  sign.value = false;
});

const nameValid = computed(
  () => tagNameSchema.safeParse(name.value.trim()).success
);
// Signing produces an annotated tag, which needs a message.
const valid = computed(
  () => nameValid.value && (!sign.value || message.value.trim().length > 0)
);

async function create() {
  if (!valid.value) return;
  hide();
  await repo.createTag({
    name: name.value,
    hash: hash.value ?? '',
    message: message.value,
    sign: sign.value
  });
}
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent>
      <UiDialogHeader>
        <UiDialogTitle>{{ t('tag.title') }}</UiDialogTitle>
        <UiDialogDescription>{{ t('tag.description') }}</UiDialogDescription>
      </UiDialogHeader>

      <div class="space-y-4">
        <div class="space-y-1.5">
          <UiLabel>{{ t('form.tag.label') }}</UiLabel>
          <UiInput
            v-model="name"
            :placeholder="t('form.tag.placeholder')"
            @keydown.enter="create"
          />
        </div>
        <div class="space-y-1.5">
          <UiLabel>{{ t('tag.message.label') }}</UiLabel>
          <UiInput
            v-model="message"
            :placeholder="t('tag.message.placeholder')"
          />
          <p class="text-xs text-muted-foreground">
            {{ t('tag.messageHint') }}
          </p>
        </div>
        <div class="flex items-center justify-between">
          <div>
            <UiLabel>{{ t('tag.sign') }}</UiLabel>
            <p class="text-xs text-muted-foreground">{{ t('tag.signHint') }}</p>
          </div>
          <UiSwitch v-model="sign" class="shrink-0" />
        </div>
      </div>

      <UiDialogFooter>
        <UiButton variant="ghost" icon="lucide:x" @click="hide">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton icon="lucide:tag" :disabled="!valid" @click="create">
          {{ t('form.create') }}
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>
