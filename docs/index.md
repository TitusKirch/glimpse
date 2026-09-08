---
title: glimpse documentation
description: How glimpse's git engine, changelists and release channels work, and why they are built that way.
---

glimpse is a lightweight, git-native desktop Git client. These pages cover the
parts of it that reading the source does not settle on its own: the reasoning
behind the git engine, the model changelists are built on, and how a release
reaches a user's machine.

::page-cards
::

Three things are documented elsewhere and are not repeated here. Installing and
running glimpse, and building it from source, are in the
[README](https://github.com/TitusKirch/glimpse#readme). The vocabulary the code
is named after — `RepoState`, `selection`, `flavor` — is in `CONTEXT.md` at the
repository root. How to contribute, and the checks a change has to pass, are in
`CONTRIBUTING.md`.
