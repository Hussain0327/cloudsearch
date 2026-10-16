"use client";

import * as React from "react";

const subscribe = () => () => {};

/** True after hydration, false during SSR and the hydration render. */
export function useIsClient(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
