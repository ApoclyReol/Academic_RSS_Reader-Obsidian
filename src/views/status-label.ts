import { t, type LocaleKey } from "../i18n";
import type { ItemStatus } from "../models/domain";

const STATUS_LABEL_KEYS: Record<ItemStatus, LocaleKey> = {
  unread: "ui.unread",
  interested: "ui.interested",
  archived: "ui.archived",
  hidden: "ui.hidden",
  expired: "ui.expired",
};

export function statusLabel(status: ItemStatus): string {
  return t(STATUS_LABEL_KEYS[status]);
}
