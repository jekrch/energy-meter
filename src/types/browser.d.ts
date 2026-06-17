// Type shims for non-standard browser APIs that lack lib.dom.d.ts coverage.
// Keeps the feature-detection in useAnalysis.ts type-safe without `any` casts.

interface Navigator {
  // Approximate device RAM in GiB (Chromium-only). Used to scale analysis limits.
  readonly deviceMemory?: number;
}

interface IdleDeadline {
  readonly didTimeout: boolean;
  timeRemaining(): number;
}

interface IdleRequestOptions {
  timeout?: number;
}

interface Window {
  requestIdleCallback?: (
    callback: (deadline: IdleDeadline) => void,
    options?: IdleRequestOptions,
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
}
