import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";

import { Providers } from "@/app/providers";
import { cn } from "@/lib/utils";

import "./globals.css";

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: { default: "Flow Motion", template: "%s · Flow Motion" },
  description:
    "Connect a GitHub repository, find automations, generate n8n workflows from an allowed set of nodes, simulate them with mock data, and export the JSON.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={cn("h-full antialiased font-sans", geistSans.variable, geistMono.variable)}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
