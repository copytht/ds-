import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";

import { nextMessageId } from "../src/lib/id";

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    console.log("[ds-] installed, first message id:", nextMessageId("install"));
  });
});
