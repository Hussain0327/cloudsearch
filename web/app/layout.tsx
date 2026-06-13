import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { TopBar } from "@/components/TopBar";

/**
 * Fonts via next/font (self-hosted, no layout shift).
 *
 * Per the design spec the display face is Clash Grotesk (Fontshare, loaded via
 * next/font/local). To keep the foundation hermetic and the build reliable
 * with no bundled font binaries, we use the spec-sanctioned fallback: Hanken
 * Grotesk at 700 for display/wordmark. Drop a Clash Grotesk woff2 into
 * app/fonts and swap --font-display to a next/font/local instance to restore it.
 */
const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

// Reuse Hanken (at heavy weights) as the display face stand-in for Clash.
const display = Hanken_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "CloudSearch — The Console",
    template: "%s · CloudSearch",
  },
  description:
    "A precise, keyboard-first AWS documentation search terminal. Stream answers with live inline citations and full query telemetry.",
  applicationName: "CloudSearch",
  metadataBase: new URL("http://localhost:3000"),
};

export const viewport: Viewport = {
  themeColor: "#0b0e14",
  colorScheme: "dark light",
};

// No-flash theme bootstrap: set data-theme before paint from localStorage,
// defaulting to dark. Runs inline, synchronously.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('cloudsearch-theme');if(t!=='light'&&t!=='dark'){t='dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${hanken.variable} ${jetbrainsMono.variable} ${display.variable} h-full`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col antialiased">
        <TopBar />
        <main className="flex-1 mx-auto w-full max-w-[1600px] px-2">
          {children}
        </main>
        <footer className="border-t border-hairline">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2 px-4 py-3 text-meta text-text-muted">
            <span>
              CloudSearch — AWS documentation search.{" "}
              <span className="text-text-secondary">browser → proxy → :8080</span>
            </span>
            <span className="[font-feature-settings:'tnum'_1,'ss01'_1]">
              build {process.env.NEXT_PUBLIC_BUILD_TAG ?? "v0.1.0"}
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
