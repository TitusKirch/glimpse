// Sample tauri-driver / WebdriverIO smoke test (scaffold — see README.md).
// Not run in CI yet: needs tauri-driver + a platform WebDriver + a built debug
// binary. `browser` is the global WebdriverIO client once wdio.conf.ts is set
// up; the directives below keep this file from tripping lint/type-check in the
// app build until the e2e toolchain is wired.
//
// @ts-nocheck
/* eslint-disable */
/* global browser, $ */

describe('glimpse smoke', () => {
  it('opens a repository and renders the commit graph', async () => {
    // The app opens the process CWD on launch; the History tab shows the graph.
    const history = await $('[data-testid="tab-history"]');
    await history.click();

    const firstCommit = await $('ul li');
    await firstCommit.waitForExist({ timeout: 5000 });
    expect(await firstCommit.isDisplayed()).toBe(true);
  });
});
