import { readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { AbstractInputSuggest, type App } from "obsidian";

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
    const normalized = query.trim().replace(/^\/+|\/+$/g, "");
    const absoluteQuery = resolve(this.vaultRoot, normalized);
    if (!isInside(this.vaultRoot, absoluteQuery)) {
      return [];
    }
    const parent = query.endsWith("/")
      ? absoluteQuery
      : dirname(absoluteQuery);
    const fragment = query.endsWith("/")
      ? ""
      : normalized.split("/").at(-1)?.toLocaleLowerCase() ?? "";
    try {
      const entries = await readdir(parent, { withFileTypes: true });
      return entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            entry.name.toLocaleLowerCase().startsWith(fragment),
        )
        .map((entry) => relative(this.vaultRoot, join(parent, entry.name)))
        .sort((left, right) => left.localeCompare(right));
    } catch {
      return [];
    }
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

function isInside(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return path === "" || (!path.startsWith("..") && !path.startsWith("/"));
}
