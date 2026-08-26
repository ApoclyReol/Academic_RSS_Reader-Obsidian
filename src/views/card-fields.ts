import { t } from "../i18n";
import type { CardPresentation } from "./card-presentation";

export function renderCardMetadata(
  container: HTMLElement,
  presentation: CardPresentation,
): void {
  const metadata = container.createEl("p", {
    cls: "rss-reader__item-metadata",
  });
  const fields: Array<{
    className: string;
    text: string;
    ariaLabel: string;
  }> = [];
  if (presentation.journal) {
    fields.push({
      className: "is-journal",
      text: presentation.journal,
      ariaLabel: t("card.journal_aria", {
        value: presentation.journal,
      }),
    });
  }
  if (presentation.publicationDate) {
    fields.push({
      className: "is-publication-date",
      text: presentation.publicationDate,
      ariaLabel: t("card.publication_date_aria", {
        value: presentation.publicationDate,
      }),
    });
  }
  if (presentation.doi) {
    const doiText = `${t("ui.doi")}: ${presentation.doi}`;
    fields.push({
      className: "is-doi",
      text: doiText,
      ariaLabel: t("card.doi_aria", {
        value: presentation.doi,
      }),
    });
  }
  for (const field of fields) {
    metadata.createSpan({
      cls: `rss-reader__item-metadata-field ${field.className}`,
      text: field.text,
      attr: {
        "aria-label": field.ariaLabel,
        title: field.text,
      },
    });
  }
}

export function renderCardLabeledField(
  container: HTMLElement,
  className: string,
  label: string,
  value: string,
): void {
  const row = container.createEl("p", {
    cls: className,
    attr: value ? { title: value } : {},
  });
  if (!value) {
    return;
  }
  row.createSpan({
    cls: "rss-reader__item-field-label",
    text: `${label}:`,
  });
  row.createSpan({
    cls: "rss-reader__item-field-value",
    text: value,
    attr: { title: value },
  });
}
