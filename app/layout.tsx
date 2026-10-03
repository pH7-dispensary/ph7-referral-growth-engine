import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin", "latin-ext"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  title: "pH7 Referral Growth Engine",
  description: "Standalone referral programme platform for pH7.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={manrope.variable}>
      <body>{children}</body>
    </html>
  );
}
