import { builtInModelOf } from "./built-in-model";
import { pageFrames } from "./frames";
import type { ActiveTab, MessageHandler, Platform } from "./types";

export const platform: Platform = {
  name: "chrome",

  // The Prompt API's LanguageModel global exists in the service worker and
  // in extension pages from Chrome 138; an older Chrome has no global and
  // reports the model as unavailable.
  builtInModel: builtInModelOf(typeof LanguageModel === "undefined" ? undefined : LanguageModel),

  async getSetting<T>(key: string, fallback: T): Promise<T> {
    const stored = await chrome.storage.local.get(key);
    return (stored[key] as T | undefined) ?? fallback;
  },

  async setSetting<T>(key: string, value: T): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  },

  async removeSetting(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  },

  sendMessage(message: unknown): Promise<unknown> {
    return chrome.runtime.sendMessage(message);
  },

  sendTabMessage(tabId: number, message: unknown, frameId: number): Promise<unknown> {
    return chrome.tabs.sendMessage(tabId, message, { frameId });
  },

  onMessage(handler: MessageHandler): void {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      const result = handler(message, sender.tab?.id);
      if (result === undefined) {
        return false;
      }
      result.then(sendResponse, (error: unknown) => {
        console.error("[offline-autofill] message handler failed", error);
        sendResponse(undefined);
      });
      // Keep the response channel open for the async handler.
      return true;
    });
  },

  async getActiveTab(): Promise<ActiveTab | undefined> {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined) {
      return undefined;
    }
    return { id: tab.id, complete: tab.status === "complete" };
  },

  async listFrames(tabId: number): Promise<number[]> {
    let frames: chrome.webNavigation.GetAllFrameResultDetails[] | null = null;
    try {
      frames = await chrome.webNavigation.getAllFrames({ tabId });
    } catch (error) {
      console.error("[offline-autofill] listing frames failed", error);
    }
    return pageFrames(frames ?? []);
  },

  async injectContentScript(tabId: number, frameId: number): Promise<void> {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ["content.js"] });
  },

  initPanelBehavior(): void {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error: unknown) => console.error("[offline-autofill] sidePanel behavior failed", error));
  },
};

