// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import EmptyState from './EmptyState.vue';

// NuxtIcon is a global auto-import in the app; stub it for the test runtime.
const global = { stubs: { NuxtIcon: { template: '<i data-icon />' } } };

describe('EmptyState', () => {
  it('renders the title and description', () => {
    const w = mount(EmptyState, {
      props: { icon: 'x', title: 'Nothing here', description: 'Try again' },
      global
    });
    expect(w.text()).toContain('Nothing here');
    expect(w.text()).toContain('Try again');
  });

  it('omits the description paragraph when not provided', () => {
    const w = mount(EmptyState, {
      props: { icon: 'x', title: 'Empty' },
      global
    });
    expect(w.text()).toContain('Empty');
    expect(w.findAll('p').length).toBe(1);
  });

  it('renders the action slot', () => {
    const w = mount(EmptyState, {
      props: { icon: 'x', title: 'Empty' },
      global,
      slots: { default: '<button>Do it</button>' }
    });
    expect(w.find('button').exists()).toBe(true);
  });
});
