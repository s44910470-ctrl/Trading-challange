import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Zuperior Arena — XAUUSD Paper Trading",
  description: "Private two-player XAUUSD paper trading competition. Virtual funds only.",
  applicationName: "Zuperior Arena",
  manifest: "./manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Zuperior Arena" },
  icons: { icon: "./icon.svg", apple: "./icon.svg" }
};
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover",
  themeColor: "#090b10"
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
