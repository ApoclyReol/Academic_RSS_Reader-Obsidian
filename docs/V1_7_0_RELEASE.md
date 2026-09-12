# Academic RSS Reader v1.7.0

[简体中文](V1_7_0_RELEASE.zh-CN.md) | English

This release improves search and navigation across the reader and its supporting views.

## Highlights

- Search the current reading basket with fuzzy keywords across titles, authors,
  journals, abstracts, DOI, feed metadata, and successfully cached title or
  abstract translations.
- Search is also available in subscription management and interest analysis;
  the debounced input keeps Chinese IME composition responsive.
- Keep basket navigation, search, and sorting controls visible while scrolling
  long lists. The Back to top action stays available at the lower right and
  returns to the list end position when the reader reaches the bottom.
- Simplify reader actions: translation comes first, related actions are grouped
  with vertical separators, and personalized recommendations open in a compact
  modal with labeled, centered controls.

This release does not change the SQLite schema, settings, or existing data.

> [!IMPORTANT]
> Requires desktop Obsidian 1.13.0 or later. Install only `main.js`,
> `manifest.json`, and `styles.css` from the GitHub Release.
