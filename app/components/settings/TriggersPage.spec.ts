// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { computed, defineComponent, ref } from 'vue';

// The page reads Nuxt auto-imports as free globals. The confirm dialog is the
// *real* promise dialog — the crash triggers are defined by the fact that they
// ask first, so stubbing it away would remove the thing under test — while
// everything it reaches past (i18n, the settings store, IPC, the toaster) is
// stubbed at that boundary.
const g = globalThis as Record<string, unknown>;
g.computed = computed;
g.defineComponent = defineComponent;
g.ref = ref;
g.useI18n = () => ({ t: (key: string) => key });
g.useSettingsStore = () => ({ pullStrategy: 'merge' });

const toasted: string[] = [];
vi.mock('vue-sonner', () => {
  const record = (m: string) => void toasted.push(m);
  return {
    toast: Object.assign(record, {
      info: record,
      success: record,
      warning: record,
      error: record
    })
  };
});

const { createPromiseDialog } = await import('@/utils/promiseDialog');
g.createPromiseDialog = createPromiseDialog;
const { useConfirm } = await import('@/composables/useConfirm');
g.useConfirm = useConfirm;
g.usePrompt = () => ({ prompt: async () => null });
g.usePullStrategy = () => ({ choose: async () => null });

let desktop = true;
g.isTauri = () => desktop;
const invoked: string[] = [];
g.tauriInvoke = async ({ command }: { command: string }) => {
  invoked.push(command);
  // A real panic never answers; a promise that never settles says so exactly.
  return new Promise(() => {});
};

const TriggersPage = (await import('./TriggersPage.vue')).default;

// Mirrors what app/plugins/errors.client.ts installs on the real app, so the
// page is exercised against the wiring a render error actually meets.
const vueErrors: unknown[] = [];

const global = {
  config: { errorHandler: (e: unknown) => void vueErrors.push(e) },
  stubs: {
    NuxtIcon: { template: '<i />' },
    UiButton: {
      props: ['disabled'],
      template: '<button :disabled="disabled"><slot /></button>'
    }
  }
};

const confirmDialog = useConfirm();

/** The buttons in the "crashes" block — the last three on the page. */
function crashButtons(w: ReturnType<typeof mount>) {
  return w.findAll('button').slice(-3);
}

beforeEach(() => {
  desktop = true;
  toasted.length = 0;
  invoked.length = 0;
  vueErrors.length = 0;
  confirmDialog.request.value = null;
});

describe('TriggersPage crash triggers', () => {
  it('says what each one will do before it does it', async () => {
    const w = mount(TriggersPage, { global });
    for (const [i, key] of ['render', 'rejection', 'backend'].entries()) {
      await crashButtons(w).at(i)!.trigger('click');
      expect(confirmDialog.request.value).toMatchObject({
        titleKey: `settings.triggers.crashes.${key}.title`,
        descriptionKey: `settings.triggers.crashes.${key}.description`,
        destructive: true
      });
      confirmDialog.answer(false);
      await w.vm.$nextTick();
    }
  });

  it('fires nothing when the confirmation is declined', async () => {
    const w = mount(TriggersPage, { global });
    await crashButtons(w).at(2)!.trigger('click');
    confirmDialog.answer(false);
    await w.vm.$nextTick();
    expect(invoked).toEqual([]);
    expect(vueErrors).toEqual([]);
  });

  it('raises a real render error the fatal error page can take over from', async () => {
    const w = mount(TriggersPage, { global });
    await crashButtons(w).at(0)!.trigger('click');
    confirmDialog.answer(true);
    await w.vm.$nextTick();
    await w.vm.$nextTick();
    expect(vueErrors).toHaveLength(1);
    expect(String(vueErrors[0])).toContain('Triggers');
  });

  it('rejects a promise with nothing awaiting it', async () => {
    const reasons: unknown[] = [];
    const seen = (reason: unknown) => void reasons.push(reason);
    process.on('unhandledRejection', seen);
    const w = mount(TriggersPage, { global });
    await crashButtons(w).at(1)!.trigger('click');
    confirmDialog.answer(true);
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 20));
    process.off('unhandledRejection', seen);
    expect(reasons.map(String).join()).toContain('Triggers');
  });

  it('crashes the backend over the IPC seam a git call uses', async () => {
    const w = mount(TriggersPage, { global });
    await crashButtons(w).at(2)!.trigger('click');
    confirmDialog.answer(true);
    await w.vm.$nextTick();
    expect(invoked).toEqual(['dev_panic']);
  });

  it('offers no backend crash outside the desktop shell', async () => {
    desktop = false;
    const w = mount(TriggersPage, { global });
    expect(crashButtons(w).at(2)!.attributes('disabled')).toBeDefined();
    expect(crashButtons(w).at(0)!.attributes('disabled')).toBeUndefined();
  });
});
