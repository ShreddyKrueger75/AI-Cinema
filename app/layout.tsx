import type { Metadata } from "next";
import { JetBrains_Mono, Inter, Knewave } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["900"],
  variable: "--font-inter",
  display: "swap",
});

const knewave = Knewave({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-knewave",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AI Cinema",
  description: "Cinematic video, made easy. Bring your own model.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jetbrainsMono.variable} ${inter.variable} ${knewave.variable}`}>
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
