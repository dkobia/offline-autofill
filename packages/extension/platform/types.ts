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
  /** Sends a one-shot message to the content script of one frame of a tab. Rejects when the frame has no listener. */
  sendTabMessage(tabId: number, message: unknown, frameId: number): Promise<unknown>;
  onMessage(handler: MessageHandler): void;

  /** The tab the user is looking at in the last focused window. */
  getActiveTab(): Promise<ActiveTab | undefined>;

  /**
   * The frames of a tab that could hold a page: the top frame first, then
   * the subframes with an http(s) or file URL, by ascending id. Application
   * forms are routinely embedded from another site (Greenhouse, Lever,
   * Workday), so a page is the set of its frames. Ids only, never URLs.
   */
  listFrames(tabId: number): Promise<number[]>;

  /**
   * Injects the content script into one frame of a tab. Needed for tabs that
   * were already open when the extension was installed or reloaded: declared
   * content scripts are only added to pages loaded afterwards. Rejects for a
   * cross-origin frame, which activeTab does not cover.
   */
  injectContentScript(tabId: number, frameId: number): Promise<void>;

  /** Chrome: make the toolbar button open the side panel. Firefox: no-op (popup). */
  initPanelBehavior(): void;
}
