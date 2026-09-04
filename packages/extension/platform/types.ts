// The Platform interface is the only seam through which browser-specific APIs
// are reached. chrome.* / browser.* never appear outside platform/.

/**
 * One-shot message handler. Return a promise to answer the message, or
 * undefined to leave it for another handler.
 */
export type MessageHandler = (message: unknown, senderTabId: number | undefined) => Promise<unknown> | undefined;

/**
 * The tab the user is looking at in the last focused window. Deliberately
 * carries no URL: without the "tabs" permission the tabs API scrubs it, so
 * the URL must be asked of the tab's content script instead.
 */
export interface ActiveTab {
  id: number;
  /** True once the tab has finished loading. */
  complete: boolean;
}

export interface Platform {
  /** Which build this is; used for target-specific styling, never for logic branches. */
  readonly name: "chrome" | "firefox";

  /** Persistent extension storage (storage.local). */
  getSetting<T>(key: string, fallback: T): Promise<T>;
  setSetting<T>(key: string, value: T): Promise<void>;
  removeSetting(key: string): Promise<void>;

  /** Sends a one-shot message to the background and awaits the response. */
  sendMessage(message: unknown): Promise<unknown>;
  /** Sends a one-shot message to the content script of a tab. Rejects when the tab has no listener. */
  sendTabMessage(tabId: number, message: unknown): Promise<unknown>;
  onMessage(handler: MessageHandler): void;

  /** The tab the user is looking at in the last focused window. */
  getActiveTab(): Promise<ActiveTab | undefined>;

  /**
   * Injects the content script into a tab. Needed for tabs that were already
   * open when the extension was installed or reloaded: declared content
   * scripts are only added to pages loaded afterwards.
   */
  injectContentScript(tabId: number): Promise<void>;

  /** Chrome: make the toolbar button open the side panel. Firefox: no-op (popup). */
  initPanelBehavior(): void;
}
