# Academic RSS Reader v1.1.1

v1.1.1 fixes the paper basket labels in English interface environments. The database schema remains version 1, and the minimum supported app version remains 1.11.4.

## Fixed

- Unread, interested, archived, hidden, and expired basket labels now resolve when the reader renders instead of during module initialization.
- English environments therefore display all five basket names in English after the app language initializes.
- Chinese basket labels remain unchanged in Chinese environments.

## Installation

Academic RSS Reader is now available in the Obsidian community plugin directory. The recommended installation method is **Settings → Community plugins → Browse**, search for **Academic RSS Reader**, then install and enable it.

Manual installation from the three GitHub Release assets remains available as a fallback.

## Documentation

- Added a durable agent guide covering architecture ownership, database invariants, localization constraints, validation, and release rules.
- Added English and Simplified Chinese troubleshooting guides.
- Documented startup order, state ownership, and the deferred Obsidian 1.13 declarative settings migration.

## Validation

- Added a regression test covering all five basket labels after switching the initialized UI language to English.
- Lint, tests, type-checking, production build, and the three-file release package all pass.
