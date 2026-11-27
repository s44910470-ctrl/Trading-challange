import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Zuperior Trading Arena",
  description: "Private 1v1 MT5 demo trading challenge dashboard"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
