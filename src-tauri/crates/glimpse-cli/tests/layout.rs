//! End-to-end cover for the headless command line's **one-shot layout writes** —
//! `worktree add|remove`, `submodule update|sync` and `sparse set|disable`.
//!
//! Same bar as the refs suite: a real repository, the outcome asserted with
//! `git` itself rather than through the code under test, and the refusal pinned
//! as hard as the success. What this group adds is that its subject is the
//! **repository's layout** — a second working tree, an embedded repository, the
//! slice of the tree that is checked out at all — so "what actually happened" is
//! read back from git's own listing of that layout, never from the arguments the
//! command was handed.

mod common;

use common::{clean_repo, git, git_out, json_of, receipt, run, scratch_repo};
use std::path::{Path, PathBuf};

/// A submodule wired in from a second local repository, returned as
/// `(outer, inner)` so both can be cleaned up.
///
/// `protocol.file.allow` is `user` by default since git 2.38 and a local-path
/// submodule is exactly what it blocks, so the *fixture* opts into it. The
/// commands under test never do: once the submodule is added, `update` and
/// `sync` work on what is already there and need no transport at all.
fn with_submodule(tag: &str) -> (PathBuf, PathBuf) {
    let outer = clean_repo(tag);
    let inner = clean_repo(&format!("{tag}-inner"));
    std::fs::write(inner.join("b.txt"), "b1\n").unwrap();
    git(&inner, &["add", "-A"]);
    git(&inner, &["commit", "-q", "-m", "second"]);

    git(
        &outer,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            "-q",
            inner.to_str().unwrap(),
            "sub",
        ],
    );
    git(&outer, &["commit", "-q", "-m", "add submodule"]);
    (outer, inner)
}

fn wipe(dirs: &[&Path]) {
    for d in dirs {
        let _ = std::fs::remove_dir_all(d);
    }
}

#[test]
fn worktree_add_creates_one_and_reports_where_it_landed() {
    let dir = clean_repo("wt-add");
    let path = dir.to_str().unwrap();
    let linked = dir.parent().unwrap().join("glimpse-cli-wt-add-linked");
    let _ = std::fs::remove_dir_all(&linked);

    let (code, out, err) = run(&[
        "worktree",
        "-C",
        path,
        "add",
        linked.to_str().unwrap(),
        "-C",
        path,
    ]);
    // The second `-C` is a global, not a worktree argument: it is stripped
    // before the verb's own parser sees the line.
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("glimpse-cli-wt-add-linked"), "{out:?}");

    // Asserted with git, not with `glimpse worktrees`.
    let listing = git_out(&dir, &["worktree", "list"]);
    assert!(
        listing.contains("glimpse-cli-wt-add-linked"),
        "git lists it: {listing:?}"
    );
    assert!(linked.join("a.txt").exists(), "the tree is checked out");

    // A running window hears about it.
    let r = receipt(&dir).expect("a receipt for a successful write");
    assert_eq!(r["action"], "worktree add");

    wipe(&[&dir, &linked]);
}

#[test]
fn worktree_add_can_be_pointed_at_an_existing_branch_and_reports_json() {
    let dir = clean_repo("wt-add-ref");
    let path = dir.to_str().unwrap();
    git(&dir, &["branch", "feature"]);
    let linked = dir.parent().unwrap().join("glimpse-cli-wt-add-ref-linked");
    let _ = std::fs::remove_dir_all(&linked);

    let (code, out, err) = run(&[
        "worktree",
        "add",
        linked.to_str().unwrap(),
        "feature",
        "-C",
        path,
        "--json",
    ]);
    assert_eq!(code, 0, "stderr: {err}");
    let report = json_of(&out);
    assert_eq!(report["action"], "worktree add");
    assert!(
        report["paths"][0]
            .as_str()
            .is_some_and(|p| p.contains("wt-add-ref-linked")),
        "the path git recorded: {report}"
    );
    assert!(
        report["detail"]
            .as_str()
            .is_some_and(|d| d.contains("feature")),
        "the branch it checked out: {report}"
    );

    let head = git_out(&linked, &["rev-parse", "--abbrev-ref", "HEAD"]);
    assert_eq!(head.trim(), "feature");

    wipe(&[&dir, &linked]);
}

#[test]
fn worktree_add_refuses_without_a_path() {
    let dir = clean_repo("wt-add-usage");
    let path = dir.to_str().unwrap();

    let (code, out, err) = run(&["worktree", "add", "-C", path]);
    assert_eq!(code, 1, "stdout: {out}");
    assert!(err.contains("worktree add"), "the usage line: {err:?}");

    // The `--json` contract holds for a refusal too.
    let (code, _out, err) = run(&["worktree", "add", "-C", path, "--json"]);
    assert_eq!(code, 1);
    assert!(json_of(&err)["error"].is_string(), "{err:?}");

    wipe(&[&dir]);
}

#[test]
fn worktree_remove_takes_it_away_and_says_what_it_was() {
    let dir = clean_repo("wt-rm");
    let path = dir.to_str().unwrap();
    let linked = dir.parent().unwrap().join("glimpse-cli-wt-rm-linked");
    let _ = std::fs::remove_dir_all(&linked);
    git(&dir, &["worktree", "add", "-q", linked.to_str().unwrap()]);

    let (code, out, err) = run(&["worktree", "remove", linked.to_str().unwrap(), "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("glimpse-cli-wt-rm-linked"), "{out:?}");
    // What it was is worth saying: after the removal nothing else remembers it.
    assert!(
        out.contains("glimpse worktree add"),
        "how to put it back: {out:?}"
    );

    let listing = git_out(&dir, &["worktree", "list"]);
    assert!(
        !listing.contains("glimpse-cli-wt-rm-linked"),
        "git no longer lists it: {listing:?}"
    );

    wipe(&[&dir, &linked]);
}

#[test]
fn worktree_remove_refuses_a_path_that_is_not_a_worktree() {
    let dir = clean_repo("wt-rm-missing");
    let path = dir.to_str().unwrap();

    let (code, out, err) = run(&["worktree", "remove", "nowhere", "-C", path]);
    assert_eq!(code, 1, "stdout: {out}");
    assert!(!err.is_empty(), "it says why");
    // Nothing was destroyed, so no window is told anything.
    assert!(receipt(&dir).is_none(), "no receipt for a refusal");

    wipe(&[&dir]);
}

#[test]
fn submodule_update_moves_the_pointer_back_and_names_what_moved() {
    let (outer, inner) = with_submodule("sm-update");
    let path = outer.to_str().unwrap();
    let sub = outer.join("sub");

    // Nothing to do yet: it is already at the recorded commit, and saying so is
    // a better answer than an invented one.
    let (code, out, err) = run(&["submodule", "update", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("already"), "{out:?}");

    // Move the submodule's checkout off the recorded commit behind git's back.
    let first = git_out(&sub, &["rev-list", "--max-parents=0", "HEAD"]);
    git(&sub, &["checkout", "-q", first.trim()]);

    let (code, out, err) = run(&["submodule", "update", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("sub"), "the submodule it moved: {out:?}");

    // Asserted with git: the pointer is back where the outer repo records it.
    let status = git_out(&outer, &["submodule", "status"]);
    assert!(
        status.trim_start().starts_with(char::is_alphanumeric),
        "in sync again (no leading + or -): {status:?}"
    );

    wipe(&[&outer, &inner]);
}

#[test]
fn submodule_update_refuses_a_repository_that_embeds_none() {
    let dir = scratch_repo("sm-update-none");
    let path = dir.to_str().unwrap();

    let (code, out, err) = run(&["submodule", "update", "-C", path]);
    assert_eq!(code, 1, "stdout: {out}");
    assert!(err.contains("no submodules"), "{err:?}");

    wipe(&[&dir]);
}

#[test]
fn submodule_sync_names_the_submodules_it_synced() {
    let (outer, inner) = with_submodule("sm-sync");
    let path = outer.to_str().unwrap();

    let (code, out, err) = run(&["submodule", "sync", "-C", path, "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let report = json_of(&out);
    assert_eq!(report["action"], "submodule sync");
    assert_eq!(report["paths"][0], "sub");

    wipe(&[&outer, &inner]);
}

#[test]
fn sparse_set_narrows_the_tree_and_reports_gits_own_patterns() {
    let dir = clean_repo("sparse-set");
    let path = dir.to_str().unwrap();
    std::fs::create_dir_all(dir.join("keep")).unwrap();
    std::fs::create_dir_all(dir.join("drop")).unwrap();
    std::fs::write(dir.join("keep/k.txt"), "k\n").unwrap();
    std::fs::write(dir.join("drop/d.txt"), "d\n").unwrap();
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-q", "-m", "two directories"]);

    let (code, out, err) = run(&["sparse", "set", "keep", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("keep"), "{out:?}");

    // Asserted against the working tree itself, which is the thing that changed.
    assert!(dir.join("keep/k.txt").exists(), "kept");
    assert!(!dir.join("drop/d.txt").exists(), "narrowed away");

    let (code, out, err) = run(&["sparse", "-C", path, "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert_eq!(json_of(&out)["enabled"], true);

    wipe(&[&dir]);
}

#[test]
fn sparse_set_refuses_without_a_directory() {
    let dir = clean_repo("sparse-set-usage");
    let path = dir.to_str().unwrap();

    let (code, out, err) = run(&["sparse", "set", "-C", path]);
    assert_eq!(code, 1, "stdout: {out}");
    assert!(err.contains("sparse set"), "the usage line: {err:?}");

    wipe(&[&dir]);
}

#[test]
fn sparse_disable_restores_the_whole_tree() {
    let dir = clean_repo("sparse-disable");
    let path = dir.to_str().unwrap();
    std::fs::create_dir_all(dir.join("keep")).unwrap();
    std::fs::create_dir_all(dir.join("drop")).unwrap();
    std::fs::write(dir.join("keep/k.txt"), "k\n").unwrap();
    std::fs::write(dir.join("drop/d.txt"), "d\n").unwrap();
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-q", "-m", "two directories"]);
    git(&dir, &["sparse-checkout", "set", "keep"]);
    assert!(!dir.join("drop/d.txt").exists(), "the fixture narrowed it");

    let (code, out, err) = run(&["sparse", "disable", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(
        out.contains("keep"),
        "what it had been narrowed to: {out:?}"
    );
    assert!(dir.join("drop/d.txt").exists(), "the whole tree is back");

    wipe(&[&dir]);
}

#[test]
fn sparse_disable_refuses_a_tree_that_is_not_narrowed() {
    let dir = clean_repo("sparse-disable-off");
    let path = dir.to_str().unwrap();

    let (code, out, err) = run(&["sparse", "disable", "-C", path]);
    assert_eq!(code, 1, "stdout: {out}");
    assert!(err.contains("sparse-checkout"), "{err:?}");
    assert!(receipt(&dir).is_none(), "no receipt for a refusal");

    wipe(&[&dir]);
}

#[test]
fn the_bare_group_words_still_list() {
    let dir = clean_repo("layout-listing");
    let path = dir.to_str().unwrap();

    // Each group word with no verb is the read view of the same subject, the
    // way `glimpse branch` lists branches.
    let (code, out, err) = run(&["worktree", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains(path), "the main worktree: {out:?}");

    let (code, out, err) = run(&["submodule", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("no submodules"), "{out:?}");

    let (code, out, err) = run(&["sparse", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("disabled"), "{out:?}");

    // The long spelling reaches the same command line, verbs included.
    let (code, out, err) = run(&["sparse-checkout", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("disabled"), "{out:?}");

    wipe(&[&dir]);
}

#[test]
fn the_long_sparse_checkout_spelling_reaches_the_verbs_and_not_the_listing() {
    // `sparse-checkout` is an alias, and an alias resolves to the *read* view
    // unless dispatch normalises it first. The listing above proves the bare
    // word arrives; it cannot tell a normalised verb from the bug the
    // normalisation exists to prevent — `glimpse sparse-checkout disable`
    // listing a narrowed tree instead of restoring it. So both verbs are driven
    // here under the long spelling, and asserted against the working tree.
    let dir = clean_repo("sparse-long");
    let path = dir.to_str().unwrap();
    std::fs::create_dir_all(dir.join("keep")).unwrap();
    std::fs::create_dir_all(dir.join("drop")).unwrap();
    std::fs::write(dir.join("keep/k.txt"), "k\n").unwrap();
    std::fs::write(dir.join("drop/d.txt"), "d\n").unwrap();
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-q", "-m", "two directories"]);

    let (code, out, err) = run(&["sparse-checkout", "set", "keep", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("keep"), "{out:?}");
    assert!(!dir.join("drop/d.txt").exists(), "it narrowed, not listed");

    let (code, _, err) = run(&["sparse-checkout", "disable", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(dir.join("drop/d.txt").exists(), "it restored, not listed");

    wipe(&[&dir]);
}

#[test]
fn an_unknown_verb_names_the_ones_that_exist() {
    let dir = clean_repo("layout-verb");
    let path = dir.to_str().unwrap();

    for (group, expected) in [
        ("worktree", "remove"),
        ("submodule", "sync"),
        ("sparse", "disable"),
    ] {
        let (code, out, err) = run(&[group, "wibble", "-C", path]);
        assert_eq!(code, 1, "stdout: {out}");
        assert!(
            err.contains(expected),
            "`{group} wibble` names the real verbs: {err:?}"
        );
    }

    wipe(&[&dir]);
}
