export interface RssReaderSettings {
  refreshIntervalMinutes: number;
  createNotesForSavedItems: boolean;
  savedItemsFolder: string;
}

export const DEFAULT_SETTINGS: RssReaderSettings = {
  refreshIntervalMinutes: 30,
  createNotesForSavedItems: true,
  savedItemsFolder: "RSS Reader/Saved",
};
