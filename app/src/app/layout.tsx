import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { JetBrains_Mono, Outfit, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });
// BBH Bartle is on Google Fonts but not in this Next.js release's font catalog yet.
const bartle = localFont({ src: "../fonts/BBHBartle.ttf", variable: "--font-display-face", weight: "400", display: "swap" });
const grotesk = Space_Grotesk({ subsets: ["latin"], weight: "400", variable: "--font-subhead" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

const description =
  "Stake USDC, trade live Pyth prices with positions sealed in MagicBlock's private rollup, survive onchain eliminations, and take the pot on Solana.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "PnL Royale — battle royale for traders",
  description,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "PnL Royale",
    description,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "PnL Royale — the battle royale for traders" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "PnL Royale",
    description,
    images: ["/og.png"],
  },
};

export const viewport: Viewport = { themeColor: "#07080c", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${outfit.variable} ${bartle.variable} ${grotesk.variable} ${jetbrains.variable}`}>
      <body className="font-sans">
        <Providers>
          <Header />
          <main className="mx-auto w-full max-w-[1200px] px-4 pb-28 pt-6 sm:px-6 md:pb-16 md:pt-8">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
