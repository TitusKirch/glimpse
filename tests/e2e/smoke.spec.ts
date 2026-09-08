// End-to-end smoke test: launches the built desktop binary through
// tauri-driver and drives the real UI. See ./README.md for the setup and how to
// run it, and for the blocker that stops it passing today.
//
// `browser`, `$` and `expect` are injected as globals by WebdriverIO; importing
// them explicitly is what lets this file type-check like the rest of the repo.

import { $, expect } from '@wdio/globals';

describe('glimpse smoke', () => {
  it('opens a repository and renders the commit graph', async () => {
    // wdio.conf.ts launches the app with this repo's path, so the History tab
    // has real commits behind it.
    const history = await $('[data-testid="tab-history"]');
    await history.waitForClickable({ timeout: 60_000 });
    await history.click();

    // `commit-graph` renders only on the branch where commits actually loaded —
    // the loading skeleton and the "no history" empty state are siblings of it,
    // so reaching this element already rules both out.
    const graph = await $('[data-testid="commit-graph"]');
    await graph.waitForDisplayed({ timeout: 60_000 });

    const firstCommit = await $('[data-testid="commit-row"]');
    await firstCommit.waitForDisplayed({ timeout: 60_000 });
    // A row exists and carries its commit's text — the subject/author line the
    // graph is there to show.
    expect(await firstCommit.getText()).not.toBe('');
  });
});
