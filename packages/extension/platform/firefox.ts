import { pageFrames } from "./frames";
import type { ActiveTab, MessageHandler, Platform } from "./types";

export const platform: Platform = {
  name: "firefox",

  // Firefox ships no Prompt API; the settings offer local servers only.
  builtInModel: undefined,

  async getSetting<T>(key: string, fallback: T): Promise<T> {
    const stored = await browser.storage.local.get(key);
    return (stored[key] as T | undefined) ?? fallback;
  },

  async setSetting<T>(key: string, value: T): Promise<void> {
    await browser.storage.local.set({ [key]: value });
  },

  async removeSetting(key: string): Promise<void> {
    await browser.storage.local.remove(key);
  },

  sendMessage(message: unknown): Promise<unknown> {
    return browser.runtime.sendMessage(message);
  },

  sendTabMessage(tabId: number, message: unknown, frameId: number): Promise<unknown> {
    return browser.tabs.sendMessage(tabId, message, { frameId });
  },

  onMessage(handler: MessageHandler): void {
    browser.runtime.onMessage.addListener((message, sender) => {
      // Returning a promise answers the message; undefined leaves it unhandled.
      return handler(message, sender.tab?.id) as Promise<unknown>;
    });
  },

  async getActiveTab(): Promise<ActiveTab | undefined> {
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined) {
      return undefined;
    }
    return { id: tab.id, complete: tab.status === "complete" };
  },

  async listFrames(tabId: number): Promise<number[]> {
    let frames: browser.webNavigation._GetAllFramesReturnDetails[] | null = null;
    try {
      frames = await browser.webNavigation.getAllFrames({ tabId });
    } catch (error) {
      console.error("[offline-autofill] listing frames failed", error);
    }
    return pageFrames(frames ?? []);
  },

  async injectContentScript(tabId: number, frameId: number): Promise<void> {
    await browser.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ["content.js"] });
  },

  initPanelBehavior(): void {
    // Firefox uses an action popup; nothing to configure.
  },
};

