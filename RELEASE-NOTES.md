# 0.4.0 — Early preview

**English** · [简体中文](RELEASE-NOTES.zh-CN.md)

Learning & Creative Investment Ledger connects spending on courses, books, tools and creative projects to practice, notes, outcomes and follow-up reviews inside Obsidian.

## Requirements

- Obsidian 1.8.7 or later, desktop edition.
- English and Simplified Chinese; follows Obsidian or uses your selected language.
- Choose currency per expense; totals stay separate without conversion. Ledger data stays in your vault as readable Markdown.

## Included

- Investment management, expenses and linked full or partial refunds.
- A vertical timeline with learning, usage, outcomes and review history.
- Links to existing notes, project files, attachments, images and web pages.
- Due-review reminders inside the plugin.
- Search, filters, category summaries, CSV export and Markdown review notes.
- Separate optional demos in English and Chinese: four investments, CNY 996 expenses, CNY 199 refunds and CNY 797 net spending.
- Readable validation feedback in native light and dark themes.
- Quick entry preserves newer input while an earlier save completes, including after switching ledgers; failed writes retain input or report the error without replacing a newer draft.
- The refund action on an expense selects that specific expense, including investments with multiple subscription payments.
- Renamed ledger files recognize valid YAML comments and quoted keys; incomplete frontmatter reports the affected file.
- Stale forms cannot recreate deleted investments or write across data-folder changes. Save and delete confirmations protect newer source edits, including edits without a changed timestamp.
- Rolling date ranges advance with the local date while custom ranges remain fixed. Reordering review history correctly recalculates the next reminder.

## Install

1. Download `learning-investment-ledger-0.4.0.zip` from this release.
2. Unzip it and copy the `learning-investment-ledger` folder into your vault's `.obsidian/plugins/` directory.
3. Ensure `main.js`, `manifest.json` and `styles.css` are directly inside that folder.
4. Reload Obsidian and enable **Investment Ledger · 学习与创作投入账本** in Community plugins.
5. Open the ledger from the ribbon or the **Open ledger** command.

The three runtime files are also attached individually. The source ZIP and GitHub's automatic source archives require a build; use the installation ZIP for manual installation. Update an existing installation by replacing its three runtime files and reloading the plugin. Ledger Markdown is stored separately.

## Preview scope

This is an early preview for desktop users. Large-vault performance, automatic multi-device conflict merging, every third-party theme and dedicated mobile behavior have not received specialized validation. Mobile is outside the current supported scope.

The plugin makes no network requests or telemetry uploads. External links open only when clicked. Files remain subject to the vault's own sync settings.

For feedback, describe the steps, expected behavior, actual behavior and plugin/Obsidian versions in the repository's Issues. Use a synthetic example and remove private note content or paths from screenshots.

## Integrity and license

`SHA256SUMS.txt` covers the prepared runtime files, ZIPs and release documents. MIT licensed; the bundled YAML dependency retains its ISC notice. See the included README and third-party notices for details.

## 0.4.0 currencies and compatibility

- Expense forms and quick entry support 18 currencies; refunds use the original expense currency.
- Integer minor units follow each currency's 0, 2 or 3 decimal places, without automatic rounding.
- Totals, category charts, investment details, CSV and Markdown reviews retain currencies separately; there is no cross-currency monetary sum.
- Existing CNY amounts and IDs remain unchanged, without migration or writes on read.
- Files containing foreign-currency transactions use schema 2 and require plugin 0.4.0 or later. Back up your vault before updating.
- 76 functional/UI regressions and 9 release-boundary checks cover legacy data, mixed currencies, refund limits, precision, persistence, exports and bilingual interactions.

- Exact integer accumulation now protects large totals, categories and net spending, with regressions for safe-integer boundaries, negative balances, refund cancellation and bilingual rendering.
