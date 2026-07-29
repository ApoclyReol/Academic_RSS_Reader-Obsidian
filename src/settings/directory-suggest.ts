import { AbstractInputSuggest, type App } from "obsidian";

import { listDirectorySuggestions } from "../services/vault-path";

export class DirectorySuggest extends AbstractInputSuggest<string> {
  limit = 30;

  constructor(
    app: App,
    input: HTMLInputElement,
    private readonly vaultRoot: string,
    private readonly onSelected: (path: string) => void,
  ) {
    super(app, input);
  }

  protected async getSuggestions(query: string): Promise<string[]> {
    return listDirectorySuggestions(
      this.vaultRoot,
      query,
      this.limit,
    );
  }

  renderSuggestion(value: string, element: HTMLElement): void {
    element.setText(value);
  }

  selectSuggestion(value: string): void {
    this.setValue(value);
    this.onSelected(value);
    this.close();
  }
}
