import { t } from "../i18n";
import type { ItemStatus } from "../models/domain";

const STATUS_LABEL_KEYS: Record<ItemStatus, string> = {
  unread: "未读",
  interested: "感兴趣",
  archived: "归档",
  hidden: "已隐藏",
  expired: "已过期",
};

export function statusLabel(status: ItemStatus): string {
  return t(STATUS_LABEL_KEYS[status]);
}
