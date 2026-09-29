import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "pH7 Referral Growth Engine",
  description: "Standalone referral programme platform for pH7.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
