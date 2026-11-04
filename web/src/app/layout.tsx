import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { AppShell } from "@/components/app-shell";
import { StationProvider } from "@/components/station";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-jb" });

export const metadata: Metadata = {
  title: "InspectAgent",
  description: "Phone-based casting inspection with SAM 3.1 and Muse Spark. No labelled data needed.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "InspectAgent", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#010102",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="overflow-x-hidden font-sans">
        <StationProvider>
          <AppShell>{children}</AppShell>
        </StationProvider>
        <Toaster theme="dark" position="top-center" toastOptions={{ style: { background: "#141516", border: "1px solid #34343a", color: "#f7f8f8" } }} />
      </body>
    </html>
  );
}
