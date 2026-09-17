export function executeUiAction(
  action: () => void | Promise<void>,
  button: HTMLButtonElement | undefined,
  onError: (error: unknown) => void,
): void {
  const shouldRestoreButton = button ? !button.disabled : false;
  if (button) {
    if (button.disabled) {
      return;
    }
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  }
  void Promise.resolve()
    .then(action)
    .catch(onError)
    .finally(() => {
      if (button) {
        button.removeAttribute("aria-busy");
        if (shouldRestoreButton && button.isConnected) {
          button.disabled = false;
        }
      }
    });
}

export function runUiAction(
  action: () => void | Promise<void>,
  button?: HTMLButtonElement,
  onError?: (error: unknown) => void,
): void {
  executeUiAction(
    action,
    button,
    onError ?? defaultUiError,
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultUiError(error: unknown): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Keep the optional UI error reporter out of DOM-only tests and helpers.
  const { Notice } = require("obsidian") as typeof import("obsidian");
  new Notice(errorMessage(error), 10_000);
}
