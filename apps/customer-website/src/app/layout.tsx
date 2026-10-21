import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../styles/index.css";
import { RewardsSessionProvider } from "@/features/tracking/context/RewardsSessionContext";
import { CustomerAssistantProvider } from "@/features/assistant/CustomerAssistantProvider";

export const metadata: Metadata = {
  title: "DeskAtlas",
  description: "DeskAtlas guest booking and workspace discovery experience",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <RewardsSessionProvider><CustomerAssistantProvider>{children}</CustomerAssistantProvider></RewardsSessionProvider>
      </body>
    </html>
  );
}
