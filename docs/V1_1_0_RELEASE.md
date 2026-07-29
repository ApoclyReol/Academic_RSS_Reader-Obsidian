# Academic RSS Reader v1.1.0

v1.1.0 adds automatic Chinese and English interface localization. The database schema remains version 1, and the minimum supported app version remains 1.11.4.

## Automatic interface language

- The plugin reads the current app language through Obsidian's `getLanguage()` API during startup.
- Chinese locales, including `zh` and `zh-*`, display the interface in Simplified Chinese.
- English and all other locales use English as the fallback.
- Settings, reader views, commands, notices, progress messages, validation errors, confirmation dialogs, and accessibility labels follow the selected interface language.
- The title translation target remains an independent user setting and does not change with the interface language.

## Compatibility

- The existing imperative `PluginSettingTab.display()` implementation remains in place for Obsidian 1.11.4 compatibility.
- Migration to the declarative settings API remains deferred until Obsidian 1.13 is formally adopted as the minimum supported version.
- Existing databases and settings require no migration.

## Validation

- Full functional testing has been completed on both Windows and macOS desktop environments.
- Platform testing covered database configuration and recovery, reader startup, feed updates, paper baskets, title translation, keyword recommendations, LLM review, interest analysis, and automatic Chinese/English interface selection.
- Chinese mode was verified with a Chinese app locale. English fallback was verified with English and non-Chinese app locales.
- Settings, reader views, commands, notices, progress messages, errors, confirmation dialogs, and accessibility labels were checked for consistent language output.
- English dictionary coverage is checked for all static localized strings.
- Chinese, English, and unsupported-locale fallback behavior is covered by automated tests.
- Lint, tests, type-checking, production build, and the three-file release package all pass.
