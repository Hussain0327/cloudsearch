"use client";

import * as React from "react";
import { Button } from "@/components/ui";

type Theme = "dark" | "light";

const STORAGE_KEY = "cloudsearch-theme";

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore storage failures (private mode, etc.) */
  }
}

/** Subscribe to data-theme changes on <html> so the store stays in sync. */
function subscribe(callback: () => void): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

function getSnapshot(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light"
    ? "light"
    : "dark";
}

/**
 * Dark-first theme toggle. The initial theme is applied by the no-flash inline
 * script in layout.tsx before paint. We read it via useSyncExternalStore so the
 * value is hydration-safe (server snapshot is the default "dark") and reflects
 * external mutations without set-state-in-effect.
 */
export function ThemeToggle() {
  const theme = React.useSyncExternalStore<Theme>(
    subscribe,
    getSnapshot,
    () => "dark",
  );

  const toggle = React.useCallback(() => {
    applyTheme(getSnapshot() === "dark" ? "light" : "dark");
  }, []);

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      title="Toggle theme"
      className="w-7 px-0"
    >
      <span aria-hidden className="text-[0.875rem] leading-none">
        {theme === "dark" ? "☾" : "☀"}
      </span>
    </Button>
  );
}
