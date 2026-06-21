# Changelog

## [0.12.0](https://github.com/TitusKirch/glimpse/compare/v0.11.0...v0.12.0) (2026-06-21)


### Features

* changelists (0.12.0) — feature, storage, UX, CLI, hunk-commit ([#97](https://github.com/TitusKirch/glimpse/issues/97)) ([d059475](https://github.com/TitusKirch/glimpse/commit/d059475470c799f6eb38948d229a2fea5bf17e8f))
* **changes:** clearer changelist panel — active list, collapse, move-all ([aa4c30e](https://github.com/TitusKirch/glimpse/commit/aa4c30e67a3d65dbd1c98b1b1c6247c094ac96de)), closes [#100](https://github.com/TitusKirch/glimpse/issues/100)
* **changes:** group pending changes into named changelists ([eda4eb8](https://github.com/TitusKirch/glimpse/commit/eda4eb8abc9d307d63d980b83c8fcb3c127f0ca2))
* **changes:** quick-add and multi-select files in changelists ([63fa51e](https://github.com/TitusKirch/glimpse/commit/63fa51e29487418391952a658786c2ff095154c5)), closes [#105](https://github.com/TitusKirch/glimpse/issues/105)
* **changes:** review & commit selected hunks from a changelist ([e9257b7](https://github.com/TitusKirch/glimpse/commit/e9257b7da8d56e467e9b346d25fbbdcc150b0b52)), closes [#106](https://github.com/TitusKirch/glimpse/issues/106)
* **changes:** self-contained review-&-commit dialog ([230a523](https://github.com/TitusKirch/glimpse/commit/230a5234346701b23c77b5146b0161c88eb4d8e1)), closes [#106](https://github.com/TitusKirch/glimpse/issues/106)
* **changes:** store changelist membership in the git dir ([7c95c24](https://github.com/TitusKirch/glimpse/commit/7c95c243b369ca1bbe268bb1c53a9465321a9c77)), closes [#99](https://github.com/TitusKirch/glimpse/issues/99)
* **cli:** drive changelists from the command line ([98a2373](https://github.com/TitusKirch/glimpse/commit/98a23735e005d9829428a45d63b0c804930f5bda)), closes [#101](https://github.com/TitusKirch/glimpse/issues/101)
* **cli:** emit structured JSON errors under --json ([1d4c695](https://github.com/TitusKirch/glimpse/commit/1d4c6950f9406879ff283cac52cf6ea63798d4ed))
* **history:** show the time of day in commit dates ([b4f11a2](https://github.com/TitusKirch/glimpse/commit/b4f11a2b56a4a58475919e7832347e0f7232bc9d))
* **settings:** gate changelist hunk-commit behind an off-by-default setting ([5fba67a](https://github.com/TitusKirch/glimpse/commit/5fba67af0a093a9eed3bb67fee8f76034a6e7010)), closes [#106](https://github.com/TitusKirch/glimpse/issues/106)
* **sidebar:** show a 'none yet' line for empty sections + hide-empty option ([816b135](https://github.com/TitusKirch/glimpse/commit/816b135122c106bcaa72f8d0b8d6d1d3f462dda7))


### Bug Fixes

* **diff:** hide index hunk-staging controls in changelist mode ([bcd9d3d](https://github.com/TitusKirch/glimpse/commit/bcd9d3d3638ea7e907bd39b41586965fa3bb9186)), closes [#106](https://github.com/TitusKirch/glimpse/issues/106)
* **loading:** show skeletons only on first load, not on refresh ([fe84d98](https://github.com/TitusKirch/glimpse/commit/fe84d987df94165674b486beb290982b5f374824)), closes [#107](https://github.com/TitusKirch/glimpse/issues/107)
* **updater:** treat a not-yet-published manifest as no update ([e137291](https://github.com/TitusKirch/glimpse/commit/e1372916ef6967141cc1043c3f826abf2e876c19))

## [0.11.0](https://github.com/TitusKirch/glimpse/compare/v0.10.0...v0.11.0) (2026-06-06)


### Features

* **repo:** open repos instantly with the correct distro icon ([7c47f91](https://github.com/TitusKirch/glimpse/commit/7c47f91607b381175089336aa274c9578962a2fd)), closes [#89](https://github.com/TitusKirch/glimpse/issues/89)
* **sidebar:** show per-section skeletons while loading ([c8d5052](https://github.com/TitusKirch/glimpse/commit/c8d50524d23db7152c3a07e9b54caf224ec0c476))


### Bug Fixes

* **a11y:** give icon-only buttons accessible names ([95a5a0b](https://github.com/TitusKirch/glimpse/commit/95a5a0b6a0c3f5f13a4309c6a8a600a6f3dcc8f4)), closes [#91](https://github.com/TitusKirch/glimpse/issues/91)
* **command:** show the full repo name and trim the path in the recent list ([07e4192](https://github.com/TitusKirch/glimpse/commit/07e41920461e112ee6ae0cab22a426d5a02f78b1))
* **recent:** read the recency cap from the settings store ([9ff50e6](https://github.com/TitusKirch/glimpse/commit/9ff50e6091ec56d417a6b75c1ecdd6fe8e1e67cc)), closes [#87](https://github.com/TitusKirch/glimpse/issues/87)
* **repo:** guard this.active across awaits in stage/unstage/discard ([4ee2fd1](https://github.com/TitusKirch/glimpse/commit/4ee2fd1ebfaa755b764655a380b238d58ebade2f)), closes [#92](https://github.com/TitusKirch/glimpse/issues/92)
* **repo:** resolve background tabs' distro and stop the icon spinner jitter ([01b4436](https://github.com/TitusKirch/glimpse/commit/01b4436bfec92ee824cc43dcac0c0c5f0036a57e))
* **settings:** use a UiAlert info box for the Repository empty state ([e785b0f](https://github.com/TitusKirch/glimpse/commit/e785b0fef084823b75d7aac895023f2c1cd87138)), closes [#88](https://github.com/TitusKirch/glimpse/issues/88)
* **ui:** dismiss tooltips when their button opens a dialog ([b64a9af](https://github.com/TitusKirch/glimpse/commit/b64a9afbf7271811de7a7ff603e67bc1f0661d7c)), closes [#86](https://github.com/TitusKirch/glimpse/issues/86)
* **ui:** make read-only list rows non-selectable ([7d4ce54](https://github.com/TitusKirch/glimpse/commit/7d4ce546e990db1dfbc184233266649dbaff057f)), closes [#85](https://github.com/TitusKirch/glimpse/issues/85)
* **ui:** stop dialog-button tooltips reappearing on focus return ([ec09d27](https://github.com/TitusKirch/glimpse/commit/ec09d27f49cf50ac55986730cb8cf473a1d759ad))

## [0.10.0](https://github.com/TitusKirch/glimpse/compare/v0.9.0...v0.10.0) (2026-06-05)


### Features

* **commit:** opt-in conventional-commit composer ([2a02fdb](https://github.com/TitusKirch/glimpse/commit/2a02fdbf48d5f1c575204c6d1556b42e6f2bd147)), closes [#77](https://github.com/TitusKirch/glimpse/issues/77)
* **confirm:** keep destructive dialogs open with an in-button busy state ([478b851](https://github.com/TitusKirch/glimpse/commit/478b8514ff3319787909085b5cbd930d5716e3fa)), closes [#80](https://github.com/TitusKirch/glimpse/issues/80)
* **diff:** collapse unchanged regions and word-wrap toggle ([dbdd427](https://github.com/TitusKirch/glimpse/commit/dbdd427b99bb96277c92efc2b1cfa58a5d7656a0)), closes [#69](https://github.com/TitusKirch/glimpse/issues/69)
* **diff:** visual image diff (side-by-side + onion-skin) ([1e73926](https://github.com/TitusKirch/glimpse/commit/1e73926d80a6ee7dfc98703b56fe877c6077d8a2)), closes [#68](https://github.com/TitusKirch/glimpse/issues/68)
* **history:** compare two selected commits ([94f0fb1](https://github.com/TitusKirch/glimpse/commit/94f0fb1fc0bcaf3fde79f88136c9cd333a2996dc)), closes [#70](https://github.com/TitusKirch/glimpse/issues/70)
* **history:** pickaxe content search (-S/-G) ([32087a8](https://github.com/TitusKirch/glimpse/commit/32087a80bb0470c0454cf6020bef107dacf66e29)), closes [#73](https://github.com/TitusKirch/glimpse/issues/73)
* **merge:** three-way merge conflict editor ([842e495](https://github.com/TitusKirch/glimpse/commit/842e4952d373a1b20e8fe698924153ab8882e7db)), closes [#65](https://github.com/TitusKirch/glimpse/issues/65)
* **palette:** global fuzzy quick-open (files, branches, commits) ([91d0f8a](https://github.com/TitusKirch/glimpse/commit/91d0f8aeebaa8c05031600a0283e2ba1ab6d0051)), closes [#72](https://github.com/TitusKirch/glimpse/issues/72)
* **patch:** export and apply .patch files ([e9c97e0](https://github.com/TitusKirch/glimpse/commit/e9c97e00cac1b641b716e0a21012c5d825712080)), closes [#78](https://github.com/TitusKirch/glimpse/issues/78)
* **settings:** commit signing (GPG/SSH) ([50cc716](https://github.com/TitusKirch/glimpse/commit/50cc716807c3afd7df2e737258377054b1ca492a)), closes [#66](https://github.com/TitusKirch/glimpse/issues/66)
* **settings:** global git settings with a per-repo override toggle ([24eb092](https://github.com/TitusKirch/glimpse/commit/24eb092d8500347f6ab1fa7149ec4e684f804290))
* **settings:** make the git identity WSL-aware ([cdff788](https://github.com/TitusKirch/glimpse/commit/cdff7887cf108cd3b4def815dfe8cfef58e6710a)), closes [#76](https://github.com/TitusKirch/glimpse/issues/76)
* **settings:** per-repo git target override + WSL distro detection ([ba05a46](https://github.com/TitusKirch/glimpse/commit/ba05a46168fef04acaf5d7a4e4fc1cb129ee7362)), closes [#74](https://github.com/TitusKirch/glimpse/issues/74)
* **settings:** per-repo SSH key selection via core.sshCommand ([178d3ab](https://github.com/TitusKirch/glimpse/commit/178d3ab6b958e6c9ab93bf200a787893ec8d7f68))
* **settings:** surface SSH keys and credential helper ([1581559](https://github.com/TitusKirch/glimpse/commit/1581559b56b36b476aa5f18b2f2fb861727565b9)), closes [#75](https://github.com/TitusKirch/glimpse/issues/75)
* **settings:** toggle-gated repo identity with alert default icons ([466ebf0](https://github.com/TitusKirch/glimpse/commit/466ebf0d137486dcaadb991e39bf1cc7c623aa79))
* **stats:** repository insights panel ([3a8e826](https://github.com/TitusKirch/glimpse/commit/3a8e82614ee896fc22ede08482b62f5f8ea1da76)), closes [#71](https://github.com/TitusKirch/glimpse/issues/71)
* **tags:** annotated and signed tags ([5ec7eb8](https://github.com/TitusKirch/glimpse/commit/5ec7eb89d2d4b9002bbcf3c81929b28963281cbf)), closes [#67](https://github.com/TitusKirch/glimpse/issues/67)
* **ui:** consistent icons on dialog buttons incl. cancel ([24b0a34](https://github.com/TitusKirch/glimpse/commit/24b0a34bef4fbdeb3fc7487dc5e4ae1afc6664c5)), closes [#81](https://github.com/TitusKirch/glimpse/issues/81)


### Bug Fixes

* **changes:** keep the commit-composer toggle ghost when active ([c3f547e](https://github.com/TitusKirch/glimpse/commit/c3f547e705c6324d7d5f137f748a4f5b2029659b))
* **settings:** clearer SSH & git-identity settings UX ([eed804c](https://github.com/TitusKirch/glimpse/commit/eed804c4dae8cd99c7f3b862173cfdf2df1cb295))
* **settings:** make the conventional-commit toggle take effect live ([0fd94d8](https://github.com/TitusKirch/glimpse/commit/0fd94d8aee08d39eee9574caa95b454dc8912d28))
* **settings:** true local identity, clearer target, SSH key picker ([0872afd](https://github.com/TitusKirch/glimpse/commit/0872afdd36d41a383452c00f83af152b1a0ab144))
* **ui:** make alert icon variant-driven, fix one-word-per-line text ([4f02535](https://github.com/TitusKirch/glimpse/commit/4f025351bb319d49493286a081565de2beec49d5))

## [0.9.0](https://github.com/TitusKirch/glimpse/compare/v0.8.0...v0.9.0) (2026-06-04)


### Features

* **commit:** explain the unverifiable signature status ([732afe1](https://github.com/TitusKirch/glimpse/commit/732afe19465d35bf0555bd742f3ef7372d2d60a1)), closes [#50](https://github.com/TitusKirch/glimpse/issues/50)
* **diff:** line-level (sub-hunk) staging ([27ad0b8](https://github.com/TitusKirch/glimpse/commit/27ad0b8e9b028f4d459fb2c532af8ea3b7b08467)), closes [#49](https://github.com/TitusKirch/glimpse/issues/49)
* **lfs:** detect and surface Git LFS-tracked files ([9479242](https://github.com/TitusKirch/glimpse/commit/9479242acf9820ac9fb91e224dc47219bc9284a8)), closes [#35](https://github.com/TitusKirch/glimpse/issues/35)
* **rebase:** interactive rebase (reword/squash/fixup/drop/reorder) ([648c51a](https://github.com/TitusKirch/glimpse/commit/648c51acb4de6785f3080ee40cc4c62136d13971)), closes [#26](https://github.com/TitusKirch/glimpse/issues/26)

## [0.8.0](https://github.com/TitusKirch/glimpse/compare/v0.7.0...v0.8.0) (2026-06-04)


### Features

* **bisect:** guided git bisect workflow ([7dde957](https://github.com/TitusKirch/glimpse/commit/7dde95753d2f30b2d0d4037693152bcd71bba099)), closes [#37](https://github.com/TitusKirch/glimpse/issues/37)
* **sparse:** enable/disable and edit sparse-checkout paths ([429065c](https://github.com/TitusKirch/glimpse/commit/429065cdea1d2f1708ea2b34029df9f43d4d83c0)), closes [#38](https://github.com/TitusKirch/glimpse/issues/38)
* **submodule:** list, update and sync submodules ([89845a9](https://github.com/TitusKirch/glimpse/commit/89845a94c9b452cbd11ac2e6d34faca183a87bb7)), closes [#34](https://github.com/TitusKirch/glimpse/issues/34)
* **worktree:** list, add, remove and open linked worktrees ([1a8fe22](https://github.com/TitusKirch/glimpse/commit/1a8fe22658af319e7cd71b4ebcbed84a61d1e8ff)), closes [#36](https://github.com/TitusKirch/glimpse/issues/36)

## [0.7.0](https://github.com/TitusKirch/glimpse/compare/v0.6.0...v0.7.0) (2026-06-04)


### Features

* **compare:** compare two arbitrary refs ([60e7cda](https://github.com/TitusKirch/glimpse/commit/60e7cdaa7fcfa25a26621f9f0554fb2dbb82209e)), closes [#27](https://github.com/TitusKirch/glimpse/issues/27)
* **rebase:** rebase the current branch onto another ref ([cd34b41](https://github.com/TitusKirch/glimpse/commit/cd34b41f999072174e3d2b86dbccddc0903cb405)), closes [#25](https://github.com/TitusKirch/glimpse/issues/25)

## [0.6.0](https://github.com/TitusKirch/glimpse/compare/v0.5.0...v0.6.0) (2026-06-04)


### Features

* **diff:** discard a single hunk from the working tree ([b812f3d](https://github.com/TitusKirch/glimpse/commit/b812f3dd576e051ed3f1cd9d4ac9d59cea141875)), closes [#30](https://github.com/TitusKirch/glimpse/issues/30)
* **history:** cherry-pick/revert multiple commits and merge reverts ([d1d5983](https://github.com/TitusKirch/glimpse/commit/d1d59831a0682b93a7124bb8d9c712ea8c912bc8)), closes [#32](https://github.com/TitusKirch/glimpse/issues/32)
* **reflog:** reflog recovery view and undo last action ([22cbece](https://github.com/TitusKirch/glimpse/commit/22cbecea785856d19b2fe74bad2278515d3d81b8)), closes [#29](https://github.com/TitusKirch/glimpse/issues/29)
* **stash:** preview contents, stash selected paths, include untracked ([982ae5a](https://github.com/TitusKirch/glimpse/commit/982ae5a39e664c04b7a47d609bf5faa5232c172b)), closes [#28](https://github.com/TitusKirch/glimpse/issues/28)

## [0.5.0](https://github.com/TitusKirch/glimpse/compare/v0.4.0...v0.5.0) (2026-06-04)


### Miscellaneous Chores

* release 0.5.0 ([a396c92](https://github.com/TitusKirch/glimpse/commit/a396c928fd0ab143b432b519d4bacaef1ab5d1d8))

## [0.4.0](https://github.com/TitusKirch/glimpse/compare/v0.3.0...v0.4.0) (2026-06-04)


### Features

* **commit:** show GPG/SSH signature verification status ([e1fbc3c](https://github.com/TitusKirch/glimpse/commit/e1fbc3c36b9c8810fe63075c912161e4fe8f5b4f)), closes [#31](https://github.com/TitusKirch/glimpse/issues/31)
* **repo:** clone a remote repository (git clone) ([1485cb8](https://github.com/TitusKirch/glimpse/commit/1485cb8f1820b74501b28016b9e390780b20d4b5)), closes [#23](https://github.com/TitusKirch/glimpse/issues/23)
* **repo:** initialise a new repository (git init) ([f1b4f08](https://github.com/TitusKirch/glimpse/commit/f1b4f089129fbe605f03aaa8affea8e180c8734b)), closes [#24](https://github.com/TitusKirch/glimpse/issues/24)
* **settings:** edit git identity in a dedicated Git settings tab ([53993bf](https://github.com/TitusKirch/glimpse/commit/53993bf4bb70cc26bd3fd809f55522bd09edac5d)), closes [#33](https://github.com/TitusKirch/glimpse/issues/33)

## [0.3.0](https://github.com/TitusKirch/glimpse/compare/v0.2.0...v0.3.0) (2026-06-04)


### Features

* **cli:** add WSL launcher that opens the Windows app ([ab7b20e](https://github.com/TitusKirch/glimpse/commit/ab7b20e18d16ff01de819d34703db511bbe09751))
* **cli:** install the launcher onto PATH from settings ([788b046](https://github.com/TitusKirch/glimpse/commit/788b046c730e27d0cd976e97e81f65ccde73fbe8))
* **cli:** install the WSL launcher and reflect install state ([4fe7b4f](https://github.com/TitusKirch/glimpse/commit/4fe7b4f41a191ed2354c60d14ad53cdae5675f34))
* **cli:** open a repo from the command line ([fef8abf](https://github.com/TitusKirch/glimpse/commit/fef8abf80df4e36503420195f83ec9ff10605c78))
* **pull:** per-pull strategy via split button, palette & diverged dialog ([5d5496b](https://github.com/TitusKirch/glimpse/commit/5d5496b614c487eb95faa3b4cf436a184f42ce91))
* **settings:** add sidebar "Edit layout" toggle ([5ab0256](https://github.com/TitusKirch/glimpse/commit/5ab02569eb98ea72059dbb7fcf2a38a3c803d406))
* **settings:** split developer settings into mode + experiments opt-in ([0ccbe2b](https://github.com/TitusKirch/glimpse/commit/0ccbe2b255f8dd097a6b8a776cbcf50fc04b35ab))
* **sidebar:** collapsible, reorderable sections ([e2aff28](https://github.com/TitusKirch/glimpse/commit/e2aff280585e7116faf83cf5125e6dfbdf049640))


### Bug Fixes

* **ci:** resolve signtool path for Azure signing; verbose beta build ([ce0f520](https://github.com/TitusKirch/glimpse/commit/ce0f5207bb85848f4420fbdf25b0d16125ec115b))
* **cli:** cache the install state so the settings button doesn't flicker ([4fb7cab](https://github.com/TitusKirch/glimpse/commit/4fb7cab306fe06606fdcf53babe513ec1bb13ec8))
* **cli:** keep the WSL launcher LF so its shebang stays valid ([9e98832](https://github.com/TitusKirch/glimpse/commit/9e988326fa53b642c622c42cddf6efb920e7d920))
* **cli:** normalise the path for wslpath so the WSL launcher installs ([b59e6e3](https://github.com/TitusKirch/glimpse/commit/b59e6e3737f875807fb44054d0233ae5ed89c5ca))
* **command-palette:** vertically center the close button ([97ad819](https://github.com/TitusKirch/glimpse/commit/97ad81901a7aa4eacb5e825a1207cb8e1ff8b67a)), closes [#41](https://github.com/TitusKirch/glimpse/issues/41)
* **dnd:** suppress tooltips while reordering tabs or sidebar sections ([e815bdd](https://github.com/TitusKirch/glimpse/commit/e815bdd012a1bb9c6e464b0a13968419d0e8e4bf)), closes [#39](https://github.com/TitusKirch/glimpse/issues/39)
* **navbar:** force SortableJS pointer fallback for tab reordering ([e95ada8](https://github.com/TitusKirch/glimpse/commit/e95ada8810c15a1e76287122693e0aa461535928))
* **sidebar:** let the reorder hint wrap instead of being clipped ([c16b580](https://github.com/TitusKirch/glimpse/commit/c16b5807ff8d03bc722fd6823c42b07ff17eb42f)), closes [#40](https://github.com/TitusKirch/glimpse/issues/40)
* **ui:** disable text selection on navbar tabs and the sidebar ([1c91f64](https://github.com/TitusKirch/glimpse/commit/1c91f6406832b1bd198c31b158eac43abe8bfb9a))
* **ui:** pointer cursor on dropdown menu items ([332017c](https://github.com/TitusKirch/glimpse/commit/332017ca562340a398b6a3b6fd5523ee0a67e4fe))
* **updater:** offer the highest version across beta and stable feeds ([ea1133f](https://github.com/TitusKirch/glimpse/commit/ea1133f47e6355f2b0b583b0ce57f7a675392b61))

## [0.2.0](https://github.com/TitusKirch/glimpse/compare/v0.1.0...v0.2.0) (2026-06-02)


### Features

* **command:** nested branch actions, grouped commands, multilingual search ([7ca7386](https://github.com/TitusKirch/glimpse/commit/7ca7386a611246494a562b1c2023a2a14be8fbd1))
* **command:** recently-used actions and configurable recent counts ([fbe8080](https://github.com/TitusKirch/glimpse/commit/fbe808087406115ea3836c560fc1a73641896a1e))
* **i18n:** bring es-ES and fr-FR to full parity, add new keys ([ff6c404](https://github.com/TitusKirch/glimpse/commit/ff6c404cf4a8cc5336d9d20e06b924560a4a3b81))
* **search:** add shared fuzzy search via useSearch (Fuse.js) ([69ddfc0](https://github.com/TitusKirch/glimpse/commit/69ddfc0f6521b27eaa4510d4f71b54762c0e09ac))
* **settings:** searchable language comboboxes and search languages ([8b83e41](https://github.com/TitusKirch/glimpse/commit/8b83e41647f53511f02534f62a5cace943ef60aa))
* **sidebar:** remote-branch actions menu + generic experiment badge ([46a9660](https://github.com/TitusKirch/glimpse/commit/46a9660defd3a1ecbf2720e89ced2531158b1b4c))
* **ui:** add popover primitive ([a0fbbd6](https://github.com/TitusKirch/glimpse/commit/a0fbbd6dfc97b9861798f7f454eebda44f7a07b8))
* **updater:** beta graduates to stable; clamp cooldown; logo box ([9a3aeb3](https://github.com/TitusKirch/glimpse/commit/9a3aeb31bd435c3c12ad415791c9ccf50b8dceea))


### Bug Fixes

* **command:** freeze the recently-used list while the palette is open ([cd5328a](https://github.com/TitusKirch/glimpse/commit/cd5328a7a98b749e3a0b89bb1fe9a2619bd1b39c))
* **command:** give combobox items a hover background and pointer cursor ([9ae8336](https://github.com/TitusKirch/glimpse/commit/9ae83362313f56347eb6173a4f41bc618b529310))
* **experiment:** drop in-dialog tooltip (no TooltipProvider in portal) ([128d164](https://github.com/TitusKirch/glimpse/commit/128d164b48ea756e0572c56f414bb0552b738aa4))
* **repo:** avoid stale and duplicate tabs when switching projects ([c483ebf](https://github.com/TitusKirch/glimpse/commit/c483ebf3bbda136f79a087f557ed63f8149e8584))
* **security:** validate git args, gate deep links, set CSP, confine file reads ([a59e66f](https://github.com/TitusKirch/glimpse/commit/a59e66f2f6a0440a85bea13df11a02ffc97af368))
* **settings:** drop the display language from search languages ([10729be](https://github.com/TitusKirch/glimpse/commit/10729be35c13031c9519069ae5ec0d8bb511370b))
* **settings:** smooth out the experiment picker ([ade5e07](https://github.com/TitusKirch/glimpse/commit/ade5e07195fd0c13c9baa8075eea5fd557ac3756))
* **sidebar:** animate the logo box collapse like the menu icons ([0c9e805](https://github.com/TitusKirch/glimpse/commit/0c9e8056dde737cdbbbb25c5de3853a7b844525d))
* **sidebar:** clip+reveal the app name on expand like the menu items ([227bb49](https://github.com/TitusKirch/glimpse/commit/227bb4990051f55d5d65ea4a32545b9983717a2a))
* **sidebar:** drop doubled pl-2 on the logo row (SidebarHeader already pads) ([a312efb](https://github.com/TitusKirch/glimpse/commit/a312efbcf26e055598223d3cce19e6899029898c))
* **sidebar:** keep logo left on collapse; experiment empty-state alert ([f6403e0](https://github.com/TitusKirch/glimpse/commit/f6403e0e7c5ccb789b9a9bcbb9c5b5fcf964db22))
* **sidebar:** keep the logo fully static on collapse (only text/badge hide) ([a4592c7](https://github.com/TitusKirch/glimpse/commit/a4592c7a07758f16e7535c5622ad7cfe7c370301))
* **sidebar:** logo 32px at pl-2, fixed on collapse (only text/badge hide) ([35c3965](https://github.com/TitusKirch/glimpse/commit/35c39657ba383c867d19c8a2c858d37a8f310f01))
* **sidebar:** open the actions dropdown for remote branches and tags when collapsed ([67a47cd](https://github.com/TitusKirch/glimpse/commit/67a47cdc701cafbc7118360d93074fdb9861c040))
* **updater:** install a channel's build when switching channels ([10bd09d](https://github.com/TitusKirch/glimpse/commit/10bd09d697905b35f9b0b37193dddaf359b9f62d))

## 0.1.0 (2026-06-02)


### Features

* add app shell and git client UI ([8ea0514](https://github.com/TitusKirch/glimpse/commit/8ea0514dea84d6f3af5acae586eb862467b320a5))
* add tauri backend (git layer + platform resolution) ([afc2bd3](https://github.com/TitusKirch/glimpse/commit/afc2bd393457fe098b400f73435d2e6b7e34809a))
* **badge:** token-based semantic variants, size + icon props ([402c116](https://github.com/TitusKirch/glimpse/commit/402c116bdedb17db563b3bdf5a5c0f32c1f85d9c))
* **blame:** richer hover-card with copy hash + view commit ([ac9ae34](https://github.com/TitusKirch/glimpse/commit/ac9ae345a7c4893572f6592b81a9105e8234e12a))
* **blame:** view-commit selects + scrolls to it in history ([1e575ee](https://github.com/TitusKirch/glimpse/commit/1e575ee9c0de11a13c1cd1ca8fbc4b69bf36e482))
* **branch:** add reverse-merge action (merge current into branch) ([98eaa04](https://github.com/TitusKirch/glimpse/commit/98eaa04ac1fa423a46f25a5e2fa4735b03531a1e))
* **changes:** auto-grow the commit message box up to a max height ([0fc13af](https://github.com/TitusKirch/glimpse/commit/0fc13af43ff9e140044076baa5393da69f09b00e))
* **changes:** grouped folder tree view with list/tree toggle ([918faff](https://github.com/TitusKirch/glimpse/commit/918faff11441cbd6674f277f8933c82c9d21e70f))
* **changes:** render merge conflicts with the tree/list view too ([75d2f46](https://github.com/TitusKirch/glimpse/commit/75d2f4601669b8e239e979121c0c6effb59b6256))
* custom syntax-highlighted diff viewer (replace [@git-diff-view](https://github.com/git-diff-view)) ([3f77525](https://github.com/TitusKirch/glimpse/commit/3f775259ff0f12ffa7afd6e7744942920c57ff74))
* **diff:** add a whole-file view alongside side-by-side/unified ([047f48d](https://github.com/TitusKirch/glimpse/commit/047f48db9f69d38f33162bb75c71996b83520477))
* **diff:** commit detail header with full message and author/date ([2244b14](https://github.com/TitusKirch/glimpse/commit/2244b14c81931a738593a476edec2f03b8f21590))
* **diff:** hunk staging, word diff, whitespace toggle, copy, file history ([46849a9](https://github.com/TitusKirch/glimpse/commit/46849a934d60593b6f749d92eeef0bfe81cb7f2f))
* **diff:** whole-file syntax highlighting (fixes Vue SFC script/style) ([46f5561](https://github.com/TitusKirch/glimpse/commit/46f5561bea93d04a11acaba92d5de1703e8fd6c4))
* **forms:** tanstack form + zod for name and remote dialogs ([f0dde07](https://github.com/TitusKirch/glimpse/commit/f0dde07d4fb392ead3abcf9addb6c1b6efda23d3))
* **git:** blame view ([3c6b476](https://github.com/TitusKirch/glimpse/commit/3c6b47651ed559652e4fe8c832526f50020310f4))
* **git:** branch rename, commit checkout, push variants ([60723b5](https://github.com/TitusKirch/glimpse/commit/60723b56614a3a9cd4d1e891b5140cc24ef438a0))
* **git:** commit operations + right-click context menu ([1fb1df9](https://github.com/TitusKirch/glimpse/commit/1fb1df9b8baf13158f053336da927c8668bb6415))
* **git:** full file content in diffs and per-commit file list ([af5d54b](https://github.com/TitusKirch/glimpse/commit/af5d54b3b6c36aef56cd07ba24ca53c4480184f7))
* **git:** merge-conflict handling, pull strategy, dirty-tree guard ([b8a3fce](https://github.com/TitusKirch/glimpse/commit/b8a3fceaa8fc282110ad0d58fa49e2d976100d62))
* **git:** merge, discard-all, push tags, remote management ([8c485c6](https://github.com/TitusKirch/glimpse/commit/8c485c6ab9335eab3cf6c3395b68bad79648395e))
* **git:** tags, stash, commit search ([24a3adb](https://github.com/TitusKirch/glimpse/commit/24a3adbf2237ce27503d7dd4ca2349ad1e319849))
* **graph:** show all branches with distinct lane colors; drop resize grips ([47b3fb0](https://github.com/TitusKirch/glimpse/commit/47b3fb04b450e295f4ca27eb504194de88871e5c))
* **header:** ahead/behind count badges on push and pull buttons ([7e19862](https://github.com/TitusKirch/glimpse/commit/7e198627298b8ec12ff0fc020d0ca0ebb1890af9))
* **i18n:** add german and english locales ([f0f4e78](https://github.com/TitusKirch/glimpse/commit/f0f4e78837d2f699a3e74accdc523c159e359c37))
* **i18n:** explicit per-locale fallback chains to en-GB ([34015b7](https://github.com/TitusKirch/glimpse/commit/34015b781d16d221f7c8f493b7fc27b09a7b3137))
* **layout:** persist window state and commit panel sizes ([4db8823](https://github.com/TitusKirch/glimpse/commit/4db88233368f5887b238f2031d179df54b565fdf))
* load more history + show-more in sidebar lists ([a37459a](https://github.com/TitusKirch/glimpse/commit/a37459a65e27a293d0ae88ef6da2b305c84158cd))
* **merge:** use --no-ff so merged branches keep their graph topology ([3355d89](https://github.com/TitusKirch/glimpse/commit/3355d89fe9deedb84c903b0031c448f80e3eb5f1))
* migrate to @nuxt/icon and surface git errors via shadcn alert ([106b64c](https://github.com/TitusKirch/glimpse/commit/106b64cb0ce8d917b978f0f719ea59ac3d1b7484))
* open-repo dialog, session restore, sidebar no-repo state + fixes ([1ec41c4](https://github.com/TitusKirch/glimpse/commit/1ec41c4ba288209a424b7b9f4f3f2061f89d42f9))
* open-repo race fix, dialogs, gildstone show-more, collapsed dropdown ([19d4767](https://github.com/TitusKirch/glimpse/commit/19d4767c7fd473f866cbe4bb9fb0015a6bd84515))
* **platform:** macOS CI, updater + deep-link scaffolding ([2a1a272](https://github.com/TitusKirch/glimpse/commit/2a1a272978ae57585487c55133452ba4abcac603))
* **repo:** open a folder as an additional repo tab ([a50d814](https://github.com/TitusKirch/glimpse/commit/a50d81429558bc161de5ada69be5ae5ee84f7952))
* **settings:** badge showcase in dev page + shorten-dependabot toggle ([4a629d9](https://github.com/TitusKirch/glimpse/commit/4a629d990981b4a601a2262b511e45e4c14c1da3))
* **settings:** general page for default diff view and file list view ([f20059f](https://github.com/TitusKirch/glimpse/commit/f20059f8f32f4b3128220c2f68239a5fc180ab50))
* **settings:** left page-nav layout + language page ([e2a0a66](https://github.com/TitusKirch/glimpse/commit/e2a0a6620b645b91888244a4acd6997e60634a8a))
* **settings:** pointer cursor on select items, flag icons for languages, wider dialog ([25faf74](https://github.com/TitusKirch/glimpse/commit/25faf74347272f48b625c95e0f434cea1489c15f))
* **settings:** sections, dev toggle with toast tester; move diff/file view to appearance ([0fd1b65](https://github.com/TitusKirch/glimpse/commit/0fd1b656c7a950ee7213b8ae91281926655d0ab9))
* **settings:** use a 128px logo variant in About ([e47dcd8](https://github.com/TitusKirch/glimpse/commit/e47dcd8a28425a88d0729cec76e7ecd0907dd1a5))
* **settings:** use the app logo in the About screen ([09a580b](https://github.com/TitusKirch/glimpse/commit/09a580bc90de6f1136675b5a4447d1723662bd7b))
* **sidebar+ui:** remote branches in sidebar; loading prop on UiButton ([c18eb77](https://github.com/TitusKirch/glimpse/commit/c18eb77ad858733d346d8cd4a0eaeb0bb90d7998))
* **sidebar:** badge local-only branches with no live upstream ([02ab57e](https://github.com/TitusKirch/glimpse/commit/02ab57ec43a4accf6432b49a23ccc3a9b0af57ab))
* **sidebar:** drag-resizable width (16–24rem), persisted ([f875ffa](https://github.com/TitusKirch/glimpse/commit/f875ffa01eead7cd55104e37c9c1fc14bbc5a347))
* **sidebar:** footer links (GitHub/Discord/Bug); fix icon shrink + refresh spinner ([fc25765](https://github.com/TitusKirch/glimpse/commit/fc25765d46621cb7ebe934913c0ac974725f21d3))
* **sidebar:** open footer links in the real browser via opener plugin ([9919e65](https://github.com/TitusKirch/glimpse/commit/9919e65230918cc39e9c6878cb0e073de961c450))
* **sidebar:** per-branch ahead/behind badges ([d4a0455](https://github.com/TitusKirch/glimpse/commit/d4a0455b31dde39fdbd98d651c760891ac653e5d))
* **sidebar:** setting to toggle resize + set width in px directly ([0fe305f](https://github.com/TitusKirch/glimpse/commit/0fe305fc41f452b8a3ef0640e9ff4e195c74097d))
* **sidebar:** settings dialog, footer links + new-branch polish ([9fa7ac6](https://github.com/TitusKirch/glimpse/commit/9fa7ac618f2ddc377e3687cc539cbea40c3c5ba0))
* **sidebar:** show BETA badge only on real pre-release builds ([08c3fd9](https://github.com/TitusKirch/glimpse/commit/08c3fd9af0e37df64ec105fd183cb56c9f0aac20))
* **sidebar:** use git-branch-plus for new-branch action and remote-only branches ([0df8d1b](https://github.com/TitusKirch/glimpse/commit/0df8d1b33380dca788c1f2118f87a0728809404e))
* **sidebar:** use the app logo in the sidebar header ([fc84b4a](https://github.com/TitusKirch/glimpse/commit/fc84b4a1d33d6e1d7818aa94a533319a580a5d9a))
* **sidebar:** widen resize range to 12–32rem ([16a81c2](https://github.com/TitusKirch/glimpse/commit/16a81c22f4075009154a4ccac2b8e82ec6cf7dbd))
* **stash:** click a stash to view its files and diffs ([72e9dab](https://github.com/TitusKirch/glimpse/commit/72e9dab23ca6c0ed3115d1434d1c0e5781adeb76))
* states/ux polish, command palette, appearance & repo settings ([2d8440d](https://github.com/TitusKirch/glimpse/commit/2d8440d8cb41f4f45fc6458aea212741f0e2cdd2))
* **tabs:** show WSL distro as a brand icon with tooltip ([d7da708](https://github.com/TitusKirch/glimpse/commit/d7da708ed3ef0fa99d66f0e669a8aa7d470af7ab))
* **ui:** add alert component ([bfc8390](https://github.com/TitusKirch/glimpse/commit/bfc8390763c4c02e4634e0d1fdd65e3be532a98f))
* **ui:** add badge component ([3bede07](https://github.com/TitusKirch/glimpse/commit/3bede07ce4ec5abae0aa88b7e8c7de5f9d05481d))
* **ui:** add button component ([fd80bb4](https://github.com/TitusKirch/glimpse/commit/fd80bb41cd0e8da6cdcc01e380cc868ec9cf42a0))
* **ui:** add input component ([ef6333c](https://github.com/TitusKirch/glimpse/commit/ef6333c02e344deeb11a43d46f753e332e29c93c))
* **ui:** add resizable component ([74a7717](https://github.com/TitusKirch/glimpse/commit/74a7717d3e47118466addf5d1f5dcc5286ea4f69))
* **ui:** add scroll-area component ([82dbccf](https://github.com/TitusKirch/glimpse/commit/82dbccffe3a4758d2fa58c44cf086ecda63bc7fe))
* **ui:** add separator component ([261a76c](https://github.com/TitusKirch/glimpse/commit/261a76cd71e822a5cf791f406dd11e8e205fbc1b))
* **ui:** add sheet component ([717e40d](https://github.com/TitusKirch/glimpse/commit/717e40de692728e6db792011c370b3419ec149ff))
* **ui:** add sidebar component ([f0508a5](https://github.com/TitusKirch/glimpse/commit/f0508a5301d507995e7521fdf7c7cf6c45a5b4df))
* **ui:** add skeleton component ([063b911](https://github.com/TitusKirch/glimpse/commit/063b911dd8e7e58c9be3d438bc42f4eee813049e))
* **ui:** add tabs component ([df12ba3](https://github.com/TitusKirch/glimpse/commit/df12ba389620bdde2c29e2bd3e5f16c946ceb9e0))
* **ui:** add tooltip component ([3b45600](https://github.com/TitusKirch/glimpse/commit/3b45600334976fe6ceda767d93cf5a281fc74ec0))
* **ui:** full-name UiTooltip on graph ref badges and sidebar branches ([05ba79c](https://github.com/TitusKirch/glimpse/commit/05ba79c9258fdfc97f392e80d224e2ba01c2d1e4))
* **ui:** min 300ms spinner; sidebar icon padding + consistency ([b689479](https://github.com/TitusKirch/glimpse/commit/b689479c0cc8a3b48121ed47af35ace6f00ece7c))
* **ui:** shared file row, clearer changes/history, resizable panes ([5fb2ff3](https://github.com/TitusKirch/glimpse/commit/5fb2ff346fa0f066cf0592fba556924d9c1436f6))
* **ui:** shortcut hints in header tooltips, refresh as icon button ([f53b60f](https://github.com/TitusKirch/glimpse/commit/f53b60f70096b09097513d7780043b8558e6a439))
* **ui:** soft semantic button variants; toast tester with title + description ([6c090d9](https://github.com/TitusKirch/glimpse/commit/6c090d9305d6dc187d94e94191e48e0a97c7a4eb))
* **ui:** surface git errors as toasts (sonner) ([8177909](https://github.com/TitusKirch/glimpse/commit/81779090d92f92596406f8f4b3b18869434d0387))
* **ui:** two-line reset menu items with icon and muted hint ([ebf0c4a](https://github.com/TitusKirch/glimpse/commit/ebf0c4a742ffc2c2c0ef710996f8665437e4b48e))
* **updater:** release-ready auto-update ([7f65f09](https://github.com/TitusKirch/glimpse/commit/7f65f09fdcf0f7a8019222108003672b2b2ee6c0))
* **updater:** stable + beta release channels ([642dd0c](https://github.com/TitusKirch/glimpse/commit/642dd0c9bd8d7a7513cce4e3b76c79dac5e03a84))
* upstream prompts (push/pull) + keyboard shortcuts help ([9d5d6dc](https://github.com/TitusKirch/glimpse/commit/9d5d6dc28f42b40b7d21a6d98fb976a5f04b6901))
* **watch:** live-refresh via a filesystem watcher ([37306e1](https://github.com/TitusKirch/glimpse/commit/37306e1455f155cda7cab7f383e99625f47c80d8))


### Bug Fixes

* **badge:** distinct beta icon (rocket) vs experiment (flask) ([e208064](https://github.com/TitusKirch/glimpse/commit/e20806435837b9b38cb057c0311e7c9ef5bb0cce))
* **badge:** experiment showcase badge uses destructive variant ([c1176b9](https://github.com/TitusKirch/glimpse/commit/c1176b90231c524089bf10d593907122c5bf1a1b))
* **badge:** legible 600/400 text shades for soft semantic variants ([8927bf6](https://github.com/TitusKirch/glimpse/commit/8927bf614d9159ec81d892dad5781e2f5331be57))
* **ci:** build only NSIS for Windows beta bundles ([654415b](https://github.com/TitusKirch/glimpse/commit/654415b8699a53ec982000ae16a616e35600c371))
* **ci:** exclude release-please-managed files from oxfmt check ([ea16a4b](https://github.com/TitusKirch/glimpse/commit/ea16a4b857b95c870ad6aa0bb3a13b3339793be5))
* **ci:** format deny.toml with oxfmt and cover toml in lint-staged ([443f4d4](https://github.com/TitusKirch/glimpse/commit/443f4d4c31013ad159afed57381f126006368058))
* **dependabot:** match managed area:* label names ([e242693](https://github.com/TitusKirch/glimpse/commit/e242693a27a53e63dd6ef25b6db8aa11d27b7b29))
* **dev:** accept HMR updates in pinia stores ([8b28a7c](https://github.com/TitusKirch/glimpse/commit/8b28a7c247130e340c3aab475a3c2423380ea495))
* dialog scroll-lock, context submenu, sidebar footer, settings, blame ([48dfb60](https://github.com/TitusKirch/glimpse/commit/48dfb600ab440d07c0dcbff7c8b7556f8f9ced81))
* **diff:** fill full row height for word-diff highlight ([f21c18f](https://github.com/TitusKirch/glimpse/commit/f21c18fc0cda63679dd2f146fef390c71910907e))
* **diff:** move tint off gutters and word-diff modified lines in unified ([28a3b7a](https://github.com/TitusKirch/glimpse/commit/28a3b7a0781977e71e04142e62730c73cda4d904))
* **diff:** pin row height to stop background flicker while scrolling ([cbaaa8d](https://github.com/TitusKirch/glimpse/commit/cbaaa8da8bb8ad7de30bcb3b56e63b8e26ea8b47))
* **git:** prevent index.lock races on concurrent git invocations ([4def086](https://github.com/TitusKirch/glimpse/commit/4def086979874440880289e6391bf8266c01bdd4))
* **graph:** also drop the trailing version/hash when shortening bot refs ([4cbc378](https://github.com/TitusKirch/glimpse/commit/4cbc378d95614dc960c44f0161eb5fb5fc4eec9b))
* **graph:** constant edge corner radius + draw upper rows on top ([2891c2e](https://github.com/TitusKirch/glimpse/commit/2891c2e2e7c0efaa4d3c2dbc7db7e7c2737cb892))
* **graph:** continue truncated branch lanes to the bottom ([21a04f7](https://github.com/TitusKirch/glimpse/commit/21a04f71446058c07e9d6fe65af6dfc52d49fa1f))
* **graph:** keep a -… marker when trimming the bot ref version/hash ([ca30908](https://github.com/TitusKirch/glimpse/commit/ca30908e3e621b9fc100d764b2913b771409375c))
* **graph:** keep branch badges from truncating ([ce27f7d](https://github.com/TitusKirch/glimpse/commit/ce27f7da7e4bde30d2f37dfd4deddda693c7b11a))
* **graph:** put ref badges on their own line above the subject ([f6d731f](https://github.com/TitusKirch/glimpse/commit/f6d731fc787c3e1ebb9dbce4aa68162646ffdc62))
* **graph:** reuse lanes after merge; straight edges with 90° corners ([9778e46](https://github.com/TitusKirch/glimpse/commit/9778e46bf5f5a93a58a23d6ad86692f253631e9a))
* **graph:** stop off-window merge parents from wasting lanes ([a010141](https://github.com/TitusKirch/glimpse/commit/a0101419b681fab42484e582909036d68abcb1b2))
* **graph:** truncate long ref badges so they don't overlap the hash ([f0260b5](https://github.com/TitusKirch/glimpse/commit/f0260b520a847860b39ea8a840034db9c6119b1e))
* **history:** keep the load-more button in place with a spinner ([1cf6a03](https://github.com/TitusKirch/glimpse/commit/1cf6a0353f13df1998d7eb696412de322f7d293f))
* **i18n:** capitalise 'Alle' in the hard-reset hint (de) ([50178e0](https://github.com/TitusKirch/glimpse/commit/50178e0f4cbf6cda6d05c4a3c1b20b0cde69b9c0))
* **i18n:** derive flag via Intl.Locale region with globe fallback ([be01321](https://github.com/TitusKirch/glimpse/commit/be013214173f076cbd1f8df35d93a8987002ba3f))
* **i18n:** enable runtime fallback via vue-i18n config file ([8689a2a](https://github.com/TitusKirch/glimpse/commit/8689a2a737919180be5236cf8e1812a61791e611))
* **i18n:** escape @ in remote url example (vue-i18n linked syntax) ([a89d993](https://github.com/TitusKirch/glimpse/commit/a89d99340a4868b5c56e61d7e134b49f5a89e10c))
* **ipc+sidebar:** run git commands off main thread; uniform branch icon size ([f41d728](https://github.com/TitusKirch/glimpse/commit/f41d7286ef3c96a80a90d41338060293dc5e08bd))
* multi-repo reloads, keep selection, context menu, pin CI actions ([7dabe56](https://github.com/TitusKirch/glimpse/commit/7dabe56a9e8297965278ed7bbb24a5c83e189881))
* **persist:** store settings in localStorage, not cookies ([50bd823](https://github.com/TitusKirch/glimpse/commit/50bd823d6b9c261a6720ec5d08e665b160393de1))
* pre-bundle vite deps to prevent blank webview on reload ([dbcdd2b](https://github.com/TitusKirch/glimpse/commit/dbcdd2b80b470b8a363ba5ed4e7a5220bc2dbd53))
* **repo-tabs:** clearer WSL2 distro tooltip, label via i18n ([4df280e](https://github.com/TitusKirch/glimpse/commit/4df280ea6f15f7a6b1a2be97d9516aae78c9c81e))
* **repo-tabs:** reorder via vuedraggable (SortableJS) ([713a872](https://github.com/TitusKirch/glimpse/commit/713a872fd45f0944014b566d1d466172d280cf28))
* **repo:** refresh reloads active repo's path; diff toggle as tabs; resizable commit detail ([32e30ad](https://github.com/TitusKirch/glimpse/commit/32e30adf706248cae9140bad2ca56fde886f01c8))
* **settings:** cap dialog at max-w-5xl ([9b61163](https://github.com/TitusKirch/glimpse/commit/9b61163bc54788a3539f5110d8838bf5442016b0))
* **settings:** flag in language trigger; actually widen dialog ([59dd931](https://github.com/TitusKirch/glimpse/commit/59dd931c66f5a32f388e75e457e56e153967cd2d))
* **settings:** register vue-sonner nuxt module; dev mode adds a Developer page ([193ece3](https://github.com/TitusKirch/glimpse/commit/193ece38721ffa3c3798c6fceef11095b8d844ac))
* **settings:** render the About description full-width ([34a6e9d](https://github.com/TitusKirch/glimpse/commit/34a6e9d41b1c1aac8e2f479bef3bf3b72be20862))
* **shortcuts:** don't double-handle Ctrl/Cmd+B ([80a7bd4](https://github.com/TitusKirch/glimpse/commit/80a7bd41fb40f997cb86caf40e493f707dd9766e))
* **sidebar+ui:** force larger branch icons; loading on refresh too ([c54552b](https://github.com/TitusKirch/glimpse/commit/c54552b785a05aa77559af898f440dbaf65f7ecc))
* **sidebar:** unsqueezed collapsed logo + BETA pre-release badge ([0b90270](https://github.com/TitusKirch/glimpse/commit/0b902704605eb711e5d7dbc8750d1c878cafb1d3))
* **sidebar:** use destructive tint for local-only badge so it shows on the active branch ([9b62728](https://github.com/TitusKirch/glimpse/commit/9b62728aec0b36cc0bb75917e020cb096c8fc8c5))
* **store:** strip git severity prefix from error toasts ([bab638c](https://github.com/TitusKirch/glimpse/commit/bab638c6569ce190e1ee6bc46acde6d3e3eda82d))
* **tooltip:** lift Kbd above the arrow; drop stray optimizeDeps entry ([75a4e48](https://github.com/TitusKirch/glimpse/commit/75a4e48fab076e4a1f1624d0f1680b9497ea2699))
* **tooltip:** render arrow behind content so a Kbd's background shows ([fe99e58](https://github.com/TitusKirch/glimpse/commit/fe99e589f996194a46c0005fc6788f5397083e72))
* **ui:** alert icon, rounder badges, blame empty-state + hover ([f752c09](https://github.com/TitusKirch/glimpse/commit/f752c0942b580764f2791acaa8f16c7c951938b6))
* **ui:** align context-menu sub-trigger icon styling with item ([a1f41aa](https://github.com/TitusKirch/glimpse/commit/a1f41aa341e6d461aba49cb53cd9478d06c52c4f))
* **ui:** dedupe vue-sonner so toasts actually render ([50359d6](https://github.com/TitusKirch/glimpse/commit/50359d67a5b53dd9dfc459ab54f6c039a0a65e8f))
* **ui:** import Toaster (not Sonner) — wrong binding caused a black screen ([2b24bd9](https://github.com/TitusKirch/glimpse/commit/2b24bd9335bd48c24a96bafc068509ce9fb4318c))
* **ui:** larger empty-state icon ([49189ed](https://github.com/TitusKirch/glimpse/commit/49189ede3cd892447431355caba27c52583964d9))
* **ui:** size empty-state icon via the size prop ([1b3e6a3](https://github.com/TitusKirch/glimpse/commit/1b3e6a3eb33865e42803a4f33e1a0434b099b047))
* **windows:** stop console flashes and run WSL git without a shell ([dee32be](https://github.com/TitusKirch/glimpse/commit/dee32befade60192be4a123cb784c358ac866109))
* **wsl:** pin working dir + surface the failing git command in errors ([c344c41](https://github.com/TitusKirch/glimpse/commit/c344c417be679d259d7291fc593ed5361eac1ef4))
* **wsl:** pin working dir with --cd so git finds the repo ([d4d8820](https://github.com/TitusKirch/glimpse/commit/d4d8820e76288109dc0497e80a29e72f0a2c1196))
* **wsl:** return a round-trippable host toplevel so re-open stays on WSL ([c4f5bbd](https://github.com/TitusKirch/glimpse/commit/c4f5bbd7534d15de081fdd7a2a2a5f5260f2480d))


### Performance Improvements

* **diff:** virtualize the diff viewer for large files ([14d8b0a](https://github.com/TitusKirch/glimpse/commit/14d8b0a696421c686271501b79f44efd2cb28bb1))
* **graph:** virtualize commit rows with TanStack Virtual ([a66731a](https://github.com/TitusKirch/glimpse/commit/a66731a970f77248cda055b6aa2967675d8d5afa))

## Changelog

All notable changes to this project are documented here. This file is managed by [release-please](https://github.com/googleapis/release-please) and updated automatically from Conventional Commits.
