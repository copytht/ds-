import { browser } from "wxt/browser";

import { readSpeak, SPEAK_STORAGE_KEY } from "../../src/lib/toggle";

const checkbox = document.querySelector<HTMLInputElement>("#speak");
if (checkbox !== null) {
  void browser.storage.local.get(SPEAK_STORAGE_KEY).then((stored) => {
    checkbox.checked = readSpeak(stored[SPEAK_STORAGE_KEY]);
  });
  checkbox.addEventListener("change", () => {
    void browser.storage.local.set({ [SPEAK_STORAGE_KEY]: checkbox.checked });
  });
}
