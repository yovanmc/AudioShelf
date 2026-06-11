import type { Step } from "./types";

/**
 * Build the "browse" walkthrough. The caller supplies navigation callbacks so
 * this stays free of React/DOM imports (and unit-testable). Each step leaves the
 * app on a distinct screen so the screenshot after it is meaningful.
 */
export function browseSteps(nav: {
  showScanResult: () => Promise<void>;
  showLibrary: () => Promise<void>;
  openFirstAuthor: () => Promise<void>;
}): Step[] {
  return [
    { name: "scan-result", run: nav.showScanResult },
    { name: "library", run: nav.showLibrary },
    { name: "author-detail", run: nav.openFirstAuthor },
  ];
}

export const walkthroughs = ["browse"] as const;
export type WalkthroughName = (typeof walkthroughs)[number];
