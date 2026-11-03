# Verification

## 0.4.0 currency regressions

76 functional/UI tests and 9 release-boundary tests cover per-transaction currencies, separated totals and category charts, original-currency refunds and caps, 0/2/3 decimal precision, legacy CNY reads without writes, schema-2 restart recovery, bilingual form/quick-entry behavior, CSV and Markdown exports. Historical native checks below describe the earlier releases.

Large-total regressions reproduce 901 and 1000 valid maximum KWD payments; verify the safe-integer boundary, exact one-unit net after large refunds, negative cross-period refunds, independent categories/currencies, formatting and bilingual chart/detail rendering. Numeric amounts remain unchanged in the Markdown source and CSV rows. A disposable native Obsidian check also loaded 901 maximum KWD payments and confirmed KWD 9,009,999,999,999.099 in totals, category charts and Markdown. The actual CSV (902 transactions including one legacy CNY record) matched independent decimal summation; both source records remained byte-identical.

Native Obsidian 1.14.5 checks in a disposable vault confirmed English and Chinese currency totals, separate category charts, locked original-currency refunds and rejected fractional JPY input with preserved form values. Native CSV export (six transactions, fifteen columns) and Markdown review were read back and matched CNY 498.00, USD 40.00, JPY 1999 and KWD 1.234. The legacy CNY source stayed byte-identical. Original test-vault settings were restored afterward.

**English** · [简体中文](verification.zh-CN.md)

Current version: **0.3.0**. The 0.1 and 0.2 native-app checks below are historical baselines, not a claim that every older browser automation script has been translated.

## 0.3.0 bilingual regression checks

**53 automated tests pass**, along with strict TypeScript checks and a production build. The six internationalization tests cover:

- Following Obsidian's language, explicit English/Chinese overrides and unsupported-locale fallback.
- Translation placeholders and literal user input, including braces and replacement characters.
- English catalog coverage for literal translation calls.
- Identical YAML data, stable schema enums, IDs, paths, money and restart recovery across language changes.
- English CSV headers, categories, review labels and exact numeric values; user text remains unchanged.
- English demo note/outcome paths, matching stable IDs and the same CNY 797 net spending as the Chinese demo.

Nine additional offline view/form regression tests exercise the actual event handlers with an in-memory DOM and a stubbed Obsidian API. In both languages, clicking the second expense's refund button selects and saves that expense, including when the first expense is fully refunded. Quick-entry checks cover typing during a delayed save, rerendering, duplicate-submit prevention, clearing an unchanged draft, preserving an existing investment selection, write failure and retry, switching ledgers during a save, and failure after entering a newer draft. Editing an existing refund retains its original expense; a generic refund remains selectable. These targeted checks supplement the earlier native-app checks below.

## Record integrity and date regressions

Fifteen further regression tests cover the five pre-publication fixes:

- Renamed sources load valid YAML comments, quoted keys, explicit string tags, flow maps and BOM/CRLF files. Truncated frontmatter identifies the affected file on a cold start; unrelated Markdown stays excluded. Indexing leaves source bytes unchanged.
- Updates from a missing investment or a previous data folder are rejected, including before a queued reload and when another folder contains copied IDs. New records remain creatable and failed operations preserve source data and input.
- Save and delete guards compare the source snapshot captured when the document was read. External edits and comments remain protected even if their YAML timestamp was not changed. Guard metadata stays in memory and is not serialized.
- Month and last-30-days ranges advance across date boundaries in both languages. CSV uses the current range before a refresh; custom ranges remain fixed. Timer, focus and visibility checks refresh due counts and release their resources when the view unloads.
- Moving the latest review earlier, including changing only its time, recomputes the next date from the remaining latest review or clears it. Older-history edits and backdated additions preserve a manually set schedule.
- In both languages, an outdated delete confirmation preserves newly added events and shows an actionable error; a fresh confirmation can then delete the record.

The current installation ZIP was also loaded in a disposable native Obsidian 1.14.5 vault. A custom filename with a quoted YAML key and comment loaded correctly. Moving the newest review earlier updated the reminder to the remaining latest review's date. A stale delete confirmation rejected an external event addition with an unchanged timestamp. Removing a record while its edit form was open blocked saving and retained the entered text. A truncated file displayed its specific filename and YAML error while valid records remained visible. The native CSV export matched the two source transactions, dates and exact total. Original test-folder settings were restored afterward. Cross-date behavior was checked with the controlled clock above, without changing the system clock.

The native-app checks below describe the earlier baseline.

Interface controls, settings, command names, attachment messages and exports are localized. Language selection is stored in the plugin settings. User-authored titles, notes and existing demo records are preserved. Native Obsidian 1.14.5 checks used only a disposable test vault:

- Switched settings between English and Simplified Chinese; forms, controls and messages updated immediately.
- Verified the English expense form and attachment controls; a zero amount showed the English error while preserving all input.
- Loaded separate English and Chinese demos: four investments, thirteen events, CNY 996 expenses, CNY 199 refunds, CNY 797 net spending, four projects and three outcomes.
- Checked the creative project and category breakdown in the real UI.
- Disabled and re-enabled the plugin: the selected language and data folder persisted. Hashes for all 30 bilingual demo Markdown files remained unchanged.
- Refreshed all four screenshots through Obsidian's DevTools node screenshot export, selecting the plugin panel or expense dialog. The exports exclude desktop control indicators and the surrounding app chrome.
- Fixed validation text becoming indistinguishable from its error background. Checked the corrected message in native light and dark themes; invalid amounts still preserve form input.

## Release packaging checks

Nine release-boundary checks cover byte-identical archives after changing source timestamps and permissions, UTF-8 names, hidden files, symlinks, private values, image metadata, trailing data, unsafe archive paths, nested archives, checksums and matching runtime assets. Packaging also scans the explicit 18-file installation list and 80-file source list, then audits every final asset and the outer materials ZIP.

## 0.2.0 attachments baseline

23 core tests passed, including optional-field compatibility, attachment metadata validation, round-trips on investments and all five event types, file/folder moves and exports.

An isolated native Obsidian 1.8.7 instance was used to check:

- Loading old records without migration.
- Linking a vault PDF, importing image/text files and adding a web URL through real forms; imported image SHA-256 matched the original.
- Loading an original 600-pixel image in the larger preview, and opening web links only on an explicit click.
- Binary-write failure with file selections and form input preserved for retry.
- Record-write failure after copying an attachment; retry reused the same file.
- Drag/paste staging, cancel before import, unlink without deleting the file, and a 720-pixel layout without horizontal overflow.
- Saving attachments on expenses, refunds, learning, outcomes, reviews and investments.
- Native rename updates, missing-image feedback, reload recovery and old-record retention.

No uncaught JavaScript errors were recorded. Files stayed local; remote images were not automatically loaded. Current bilingual screenshots are linked below; older captures with superseded amounts were replaced.

The historical reproduction helper is `scripts/attachment_acceptance.py`, using loopback debugging port 9226. Test paths are resolved in the operator's temporary directory at runtime; the helper verifies the disposable vault path before writing. Its image fixtures are synthetic checkerboards.

## 0.1.0 MVP baseline

The original 19 core tests and 15 groups of native UI flows passed. Tests used an isolated vault and profile, without installing into a real personal vault. Initial checks used Obsidian 1.8.7; a temporary instance auto-updated to 1.14.5 for follow-up checks. The build requires Node.js 22 or later. Cross-platform behavior has not received specialized validation.

| Acceptance criterion | Evidence |
| --- | --- |
| Expense/refund arithmetic | Real forms matched the original specification arithmetic case. An additional 0.01 refund above the original expense was rejected while preserving input. |
| Events, ordering and filters | All five types appeared; reverse ordering and combined type/keyword filters worked. |
| Investment details and links | Selecting events opened the correct investment; outcomes opened the correct native notes; renames updated structured links. |
| Edits and deletion | Changing an expense by CNY 1 updated the total by CNY 1; restoring the expense restored the total. Confirmed learning-record deletion updated the timeline. |
| Reviews due and history | A review due today counted as one; completing it without another date cleared the count and retained history after restart. |
| Persistence | Rebuilding a new store and fully restarting the isolated app retained records, links and schedules. |
| Error states | Empty state, demo loading, missing links, failed writes, damaged YAML, explicit file errors and recovery were checked. |
| Exports | Four transaction rows matched the recorded dates, amounts and net spending; Markdown retained reflection and links. |

A regression test covers Obsidian's automatic wiki-link update writing an older snapshot after a rename: only pre-rename revisions are repaired; later deliberate edits remain authoritative.

Light/dark themes, 720-pixel dismissible details and a 430-pixel compact layout were also checked. No uncaught UI errors were recorded.

## Reproduce

```sh
npm ci
npm test
npm run build
```

Historical native-app helpers require Obsidian and Python Playwright. They use synthetic test data and Chinese baseline labels; for version 0.3, explicitly select Chinese before reproducing those label-specific flows.

```sh
node scripts/setup-test-vault.mjs
```

The setup command prints the disposable vault and profile locations for the current operator. Start Obsidian with that profile using `--user-data-dir`, `--remote-debugging-port=9225` and `--no-first-run`, then run:

```sh
python scripts/ui_acceptance.py --reset
```

The helpers verify the active vault path first. `--reset` moves previous records from that isolated vault to its own trash. Restart the isolated app with the same parameters, then run `python scripts/ui_acceptance.py --restart-check` to verify recovery. `scripts/capture-ui.py` captures UI examples.

## Screenshots and limits

[English timeline](screenshots/timeline-en.png) · [Chinese timeline](screenshots/timeline-zh-CN.png) · [Chinese period review](screenshots/summary-zh-CN.png) · [English validation feedback](screenshots/record-en.png).

The screenshots are fresh, unretouched PNG exports from the real 0.3.0 interface using synthetic demo data. Timeline previews use newest-first ordering. The English expense dialog shows an intentionally rejected zero amount, the preserved input and attachment controls. Light/dark and narrow-layout coverage is described above. Tests cover the local, single-user MVP. Large-vault throughput, automatic merging of multi-device conflicts, every third-party theme and dedicated mobile behavior have not received specialized validation.
