"use client";

import * as React from "react";

export interface CodeBlockProps {
  code: string;
  lang?: string;
}

/**
 * Fenced code block rendered in JetBrains Mono with a copy button. No syntax
 * highlighting (keeps the bundle lean and the aesthetic flat/utilitarian).
 */
export function CodeBlock({ code, lang }: CodeBlockProps) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="group relative my-3 overflow-hidden rounded-[var(--radius-md)] border border-hairline bg-app">
      <div className="flex items-center justify-between border-b border-hairline bg-raised px-3 py-1.5">
        <span className="font-mono text-[0.6875rem] uppercase tracking-[0.08em] text-text-muted">
          {lang || "code"}
        </span>
        <button
          type="button"
          onClick={copy}
          className="font-mono text-[0.6875rem] uppercase tracking-[0.06em] text-text-secondary transition-colors hover:text-cyan"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3">
        <code className="font-mono text-[0.8125rem] leading-relaxed text-text-primary [font-feature-settings:'tnum'_1,'ss01'_1]">
          {code}
        </code>
      </pre>
    </div>
  );
}
