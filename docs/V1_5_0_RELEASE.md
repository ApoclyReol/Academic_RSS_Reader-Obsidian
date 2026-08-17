# Academic RSS Reader v1.5.0

[简体中文](V1_5_0_RELEASE.zh-CN.md) | English

This feature release adds native graphical abstracts from RSS and Atom feeds.

## What is new

1. Graphical abstracts are extracted from item-level media fields, image
   enclosures, Atom enclosures, or images embedded in feed summaries. The
   plugin does not fetch article pages.
2. Paper cards use a stable content-and-image layout with lazy loading,
   load-failure fallback, and an image-size-aware preview modal.
3. Titles reserve three lines, support selectable text, and render delimited
   LaTeX fragments through Obsidian's native MathJax.
4. Subscription management uses one journal field, repairs malformed legacy
   OPML metadata when possible, and presents cleaner subscription and
   analytics tables.

## Database upgrade

Schema 5 adds the nullable `items.image_url` column. Existing images are not
downloaded or backfilled. A v3 database upgrades through v4 and then v5; a v4
database applies only v5. The existing protection backup and rollback process
remains in effect.

> [!IMPORTANT]
> Requires desktop Obsidian 1.13.0 or later with Node.js 22.16+ and
> `node:sqlite`.

Install only `main.js`, `manifest.json`, and `styles.css` from the GitHub
Release.
