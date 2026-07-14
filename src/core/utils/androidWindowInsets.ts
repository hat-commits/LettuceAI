interface AndroidWindowInsetsSnapshot {
  imeBottomPx?: unknown;
  statusBarTopPx?: unknown;
  source?: unknown;
}

interface AndroidWindowInsetsBridge {
  getSnapshotJson: () => string;
}

declare global {
  interface Window {
    LettuceAndroidWindowInsets?: AndroidWindowInsetsBridge;
    __lettuceWindowInsets?: AndroidWindowInsetsSnapshot;
  }
}

function readPixelInset(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Android exposes this bridge before the WebView document is created. Reading
 * it here avoids losing the first native Insets callback during app startup.
 */
export function bootstrapAndroidWindowInsets() {
  const bridge = window.LettuceAndroidWindowInsets;
  if (!bridge) return;

  try {
    const snapshot = JSON.parse(bridge.getSnapshotJson()) as AndroidWindowInsetsSnapshot;
    const statusBarTopPx = readPixelInset(snapshot.statusBarTopPx);
    const imeBottomPx = readPixelInset(snapshot.imeBottomPx);
    const density = window.devicePixelRatio || 1;

    window.__lettuceWindowInsets = { imeBottomPx, statusBarTopPx };
    document.documentElement.style.setProperty(
      "--lettuce-safe-area-inset-top",
      `${statusBarTopPx / density}px`,
    );
    document.documentElement.style.setProperty(
      "--lettuce-keyboard-inset",
      `${imeBottomPx / density}px`,
    );
  } catch (error) {
    console.warn("Failed to read initial Android window insets", error);
  }
}
