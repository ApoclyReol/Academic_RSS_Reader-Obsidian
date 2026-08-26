# Academic RSS Reader v1.6.0

[简体中文](V1_6_0_RELEASE.zh-CN.md) | English

This feature release makes paper-card research metadata configurable while
preserving a stable, low-noise reading layout.

## Highlights

1. A new **Paper cards** settings group controls journal, authors, publication
   date, DOI, feed-provided text abstract, and graphical abstract visibility.
   Titles, recommendation evidence, and actions always remain visible.
2. Every card uses one height derived from the globally enabled rows. Missing
   item values and image loading no longer change individual card height.
3. Publication dates are localized with a year fallback. Metadata-only feed
   summaries are not presented as abstracts, while stored source text and
   recommendation features remain unchanged.
4. When all card fields are enabled, metadata stays in one compact left-aligned row and author/
   abstract values share a fixed label column, while card heights remain uniform.
5. Turning off graphical abstracts prevents card image elements and their
   remote requests from being created. Lazy loading, failure fallback, and
   keyboard-accessible previews remain available when images are enabled.

## Fixes and polish

- Status actions such as **Interested**, **Archive**, **Hide**, and **Restore**
  now preserve the reader's current scroll position instead of jumping back to
  the top of the list.
- When all optional fields are enabled, card spacing is compact and the author
  and abstract text starts from the same fixed label column. Long values remain
  clipped within their row while the complete text is available on hover.

Existing settings automatically receive defaults that reproduce the v1.5.0
card appearance. This release does not change the database schema.

> [!IMPORTANT]
> Requires desktop Obsidian 1.13.0 or later. If the bundled runtime is
> incompatible, update Obsidian and try again.

Install only `main.js`, `manifest.json`, and `styles.css` from the GitHub
Release.
