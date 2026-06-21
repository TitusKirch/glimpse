<script setup lang="ts">
// The commit box: message field (TanStack Form + Zod, two-way bound to
// repo.commitMessage), the opt-in Conventional Commit composer, amend toggle and
// the commit button. Shared by both the staged/unstaged Panel and the
// ChangelistPanel — `count` is what will be committed (drives the disabled state
// and the "(N)" badge), and `submit` is fired when the user commits.
import { useForm } from '@tanstack/vue-form';
import { z } from 'zod';

// `contextLabel` (optional) names what is being committed — the ChangelistPanel
// passes the active list so it is unmistakable which list the button targets;
// the staged Panel leaves it unset.
const props = defineProps<{ count: number; contextLabel?: string }>();
const emit = defineEmits<{ submit: [] }>();

const repo = useRepoStore();
const { t } = useI18n();

const modLabel = navigator.platform.toLowerCase().includes('mac')
  ? '⌘'
  : 'Ctrl';

// Subject is the first line; git convention favours <= 50 chars (warn), hard 72.
const subjectLen = computed(
  () => repo.commitMessage.split('\n')[0]?.length ?? 0
);
const subjectClass = computed(() =>
  subjectLen.value > 72
    ? 'text-destructive'
    : subjectLen.value > 50
      ? 'text-warning'
      : 'text-muted-foreground'
);

const canCommit = computed(
  () => !!repo.commitMessage.trim() && (repo.amend || props.count > 0)
);

// --- Conventional Commit composer (opt-in) ---------------------------------
const ccType = ref('feat');
const ccScope = ref('');
const ccBreaking = ref(false);

// On/off is shared, git-config-backed state so the settings toggle and this
// commit box stay in sync live.
const {
  enabled: ccEnabled,
  load: loadConventional,
  set: setConventional
} = useConventionalCommits();
onMounted(loadConventional);
watch(() => repo.active?.path, loadConventional);

function applyConventional() {
  repo.commitMessage = applyConventionalPrefix(repo.commitMessage, {
    type: ccType.value,
    scope: ccScope.value,
    breaking: ccBreaking.value
  });
}
watch([ccType, ccScope, ccBreaking, ccEnabled], () => {
  if (ccEnabled.value) applyConventional();
});

function insertCloses() {
  repo.commitMessage = `${repo.commitMessage.replace(/\s*$/, '')}\n\nCloses #`;
}

// The store owns repo.commitMessage; the field two-way syncs with it.
const commitForm = useForm({
  defaultValues: { message: repo.commitMessage },
  validators: { onChange: z.object({ message: z.string().trim().min(1) }) },
  onSubmit: () => emit('submit')
});
watch(
  () => commitForm.state.values.message,
  (m) => {
    if (repo.commitMessage !== m) repo.commitMessage = m;
  }
);
watch(
  () => repo.commitMessage,
  (m) => {
    if (commitForm.state.values.message !== m)
      commitForm.setFieldValue('message', m);
  }
);

// Auto-grow the box with its content (capped via CSS, then it scrolls).
const commitBox = ref<HTMLTextAreaElement | null>(null);
function autoResize() {
  const el = commitBox.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}
watch(
  () => repo.commitMessage,
  () => nextTick(autoResize)
);
onMounted(autoResize);
</script>

<template>
  <form class="border-t p-2" @submit.prevent="commitForm.handleSubmit">
    <div v-if="ccEnabled" class="mb-2 flex flex-wrap items-center gap-1.5">
      <UiDropdownMenu>
        <UiDropdownMenuTrigger as-child>
          <UiButton
            type="button"
            variant="outline"
            size="sm"
            class="h-7 gap-1 px-2 text-xs"
          >
            {{ ccType }}
            <NuxtIcon name="lucide:chevron-down" class="size-3 opacity-60" />
          </UiButton>
        </UiDropdownMenuTrigger>
        <UiDropdownMenuContent align="start">
          <UiDropdownMenuItem
            v-for="ty in CONVENTIONAL_TYPES"
            :key="ty"
            @click="ccType = ty"
          >
            {{ ty }}
          </UiDropdownMenuItem>
        </UiDropdownMenuContent>
      </UiDropdownMenu>
      <input
        v-model="ccScope"
        :placeholder="t('changes.conventional.scope')"
        class="h-7 w-24 rounded-md border bg-transparent px-2 text-xs outline-none"
      />
      <label class="flex items-center gap-1 text-xs text-muted-foreground">
        <UiSwitch
          :model-value="ccBreaking"
          @update:model-value="(v) => (ccBreaking = v as boolean)"
        />
        {{ t('changes.conventional.breaking') }}
      </label>
      <UiButton
        type="button"
        size="sm"
        variant="ghost"
        class="ml-auto h-7 text-xs"
        @click="insertCloses"
      >
        {{ t('changes.conventional.closes') }}
      </UiButton>
    </div>
    <div class="relative">
      <commitForm.Field v-slot="{ field }" name="message">
        <textarea
          ref="commitBox"
          :value="field.state.value"
          :placeholder="t('changes.commit.placeholder')"
          class="max-h-48 min-h-[4.5rem] w-full resize-none overflow-y-auto rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          @input="
            field.handleChange(($event.target as HTMLTextAreaElement).value);
            autoResize();
          "
        />
      </commitForm.Field>
      <span
        class="pointer-events-none absolute right-2 bottom-1.5 font-mono text-[10px]"
        :class="subjectClass"
        >{{ subjectLen }}</span
      >
    </div>

    <div class="mt-2 flex items-center justify-between gap-2">
      <div class="flex items-center gap-3">
        <label class="flex cursor-pointer items-center gap-1.5 text-xs">
          <UiSwitch
            :model-value="repo.amend"
            @update:model-value="repo.setAmend($event)"
          />
          <span class="text-muted-foreground">{{ t('changes.amend') }}</span>
        </label>
        <UiTooltip>
          <UiTooltipTrigger as-child>
            <UiButton
              type="button"
              variant="ghost"
              size="icon-sm"
              icon="lucide:braces"
              icon-size="sm"
              :aria-label="t('changes.conventional.toggle')"
              :class="ccEnabled && 'text-primary'"
              @click="setConventional(!ccEnabled)"
            />
          </UiTooltipTrigger>
          <UiTooltipContent>{{
            t('changes.conventional.toggle')
          }}</UiTooltipContent>
        </UiTooltip>
      </div>
      <UiKbd>{{ modLabel }}+↵</UiKbd>
    </div>

    <p
      v-if="contextLabel"
      class="mt-2 flex items-center gap-1 truncate text-xs text-muted-foreground"
    >
      <NuxtIcon name="lucide:corner-down-right" class="size-3 shrink-0" />
      <span class="truncate">{{ contextLabel }}</span>
    </p>

    <UiButton
      class="mt-2 w-full"
      size="sm"
      type="submit"
      :disabled="!canCommit"
    >
      {{ repo.amend ? t('changes.amendCommit') : t('changes.commit.label') }}
      <span v-if="!repo.amend && count">({{ count }})</span>
    </UiButton>
  </form>
</template>
