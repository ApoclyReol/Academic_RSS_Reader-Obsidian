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
