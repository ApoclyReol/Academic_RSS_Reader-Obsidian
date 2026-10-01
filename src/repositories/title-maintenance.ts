import type { RssDatabase } from "../database/database";
import { normalizeText } from "../models/item-identity";
import { cleanTitleText } from "../models/title-text";
import { translationInputText } from "../models/translation-source";
import type { TranslationField } from "../models/domain";
import { textValue, type RepositoryRow } from "./repository-helpers";

const REPAIR_KEY = "title_markup_repair_v1";

/** Run before services start. Backup must succeed before any historical text is changed. */
export async function repairTitleMarkup(database: RssDatabase): Promise<void> {
  if (database.get<{ value: string }>(
    "SELECT value FROM app_metadata WHERE key=$key", { $key: REPAIR_KEY },
  )?.value === "completed") return;

  const titles = database.query<RepositoryRow>("SELECT id,title,title_norm FROM items")
    .map((row) => ({ row, title: cleanTitleText(textValue(row.title)) }))
    .filter(({ row, title }) => title &&
      (title !== textValue(row.title) || normalizeText(title) !== textValue(row.title_norm)));
  const translations = database.query<RepositoryRow>("SELECT * FROM translations")
    .map((row) => ({
      row,
      source: translationInputText(textValue(row.field) as TranslationField, textValue(row.source_text)),
      translated: row.translated_text === null ? null :
        (row.field === "title" ? cleanTitleText(textValue(row.translated_text)) : textValue(row.translated_text)),
    }))
    .filter(({ row, source, translated }) =>
      source !== textValue(row.source_normalized) || translated !== row.translated_text);

  if (titles.length || translations.length) {
    const parent = database.path.split("/").slice(0, -1).join("/");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await database.backup(`${parent ? `${parent}/` : ""}backups/before-title-cleanup-${stamp}.sqlite3`);
  }
  await database.write((db) => {
    for (const { row, title } of titles) {
      db.run("UPDATE items SET title=$title,title_norm=$norm WHERE id=$id", {
        $title: title, $norm: normalizeText(title), $id: row.id,
      });
    }
    for (const { row, source, translated } of translations) {
      db.run(`UPDATE translations SET source_normalized=$source,translated_text=$translated
        WHERE item_id=$id AND field=$field AND target_language=$target`, {
        $source: source, $translated: translated, $id: row.item_id,
        $field: row.field, $target: row.target_language,
      });
    }
    db.run("INSERT OR REPLACE INTO app_metadata(key,value) VALUES ($key,'completed')", { $key: REPAIR_KEY });
  });
}
