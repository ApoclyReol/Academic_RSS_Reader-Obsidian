import { Window as HappyWindow } from "happy-dom";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { executeUiAction } from "../src/views/ui-action";

describe("DOM UI contracts", () => {
  it("reports rejected actions and restores button state", async () => {
    const window = new HappyWindow();
    const button = window.document.createElement(
      "button",
    ) as unknown as HTMLButtonElement;
    window.document.body.append(button as never);
    const onError = vi.fn();

    executeUiAction(
      async () => {
        throw new Error("failed");
      },
      button,
      onError,
    );
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledOnce();
      expect(button.disabled).toBe(false);
      expect(button.hasAttribute("aria-busy")).toBe(false);
    });
  });

  it("uses the element owner window as the popout realm", () => {
    const mainWindow = new HappyWindow();
    const popoutWindow = new HappyWindow();
    const element = popoutWindow.document.createElement("div");

    expect(element.ownerDocument.defaultView).toBe(popoutWindow);
    expect(element.ownerDocument.defaultView).not.toBe(mainWindow);
    expect(element instanceof popoutWindow.HTMLElement).toBe(true);
  });
});
