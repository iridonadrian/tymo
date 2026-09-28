import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { ACCENT_COOKIE, accentCss } from "@/lib/accent";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Tymo", template: "%s · Tymo" },
  description: "Open-source digital memory for the internet. Save it. Close it. Find it later.",
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Tymo", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  colorScheme: "dark light",
};

/** Theme preference lives in a cookie so the server renders the right theme (no flash). */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const pref = jar.get("tymo_theme")?.value;
  // Validated hex → CSS custom properties; see lib/accent.ts.
  const accent = accentCss(jar.get(ACCENT_COOKIE)?.value);
  const theme = pref === "light" || pref === "dark" ? pref : undefined;
  return (
    <html lang="en" data-theme={theme} className={`${inter.variable} ${mono.variable}`}>
      <head>
        <style id="tymo-accent">{accent}</style>
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
