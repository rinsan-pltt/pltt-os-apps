"use client";

/**
 * One-time `window.fetch` guard for multipart uploads.
 *
 * The platform's sandbox `apiFetch` bridge injects `Content-Type:
 * application/json` onto every request it forwards. For a `FormData` body that
 * header clobbers the browser's own `multipart/form-data; boundary=…`, so the
 * boundary is lost and FastAPI parses no `file` — the upload fails on the
 * hosted OS preview/server (surfaces as 401/422) even though it works in
 * `pltt dev` (whose local bridge doesn't inject the header).
 *
 * Stripping `Content-Type` whenever the body is `FormData` makes the browser
 * set the correct multipart header + boundary again. This mirrors the guard the
 * reference plugin installs (palette-creative-labs/frontend/app/layout.tsx) and
 * fixes ALL of this app's uploads (dataroom documents, overlay images, mascot
 * art, brand logo) at once, since they all POST FormData through `apiFetch`.
 *
 * Imported for its side effect from the app entry BEFORE the SDK is imported,
 * so the patch is in place before any `apiFetch` call runs.
 */

declare global {
  interface Window {
    __newsletterFetchGuardInstalled?: boolean;
  }
}

if (typeof window !== "undefined" && !window.__newsletterFetchGuardInstalled) {
  window.__newsletterFetchGuardInstalled = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (init && init.body instanceof FormData) {
      const headers = new Headers(init.headers || {});
      headers.delete("Content-Type");
      headers.delete("content-type");
      return originalFetch(input, { ...init, headers });
    }
    return originalFetch(input, init);
  };
}

export {};
