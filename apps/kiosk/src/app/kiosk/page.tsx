"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WelcomeScreen } from "../features/welcome/WelcomeScreen";
import { KioskScanner } from "../features/qr-scanner/KioskScanner";
import { KioskReferenceEntry } from "../features/qr-scanner/KioskReferenceEntry";
import { SessionManager } from "../features/session/SessionManager";

export default function KioskStartPage() {
  const router = useRouter();
  const [activeView, setActiveView] = useState<"WELCOME" | "SCANNER" | "REFERENCE">("WELCOME");

  if (activeView === "SCANNER") {
    return (
      <SessionManager onReset={() => setActiveView("WELCOME")}>
        <KioskScanner
          onCancel={() => setActiveView("WELCOME")}
          onSwitchToReference={() => setActiveView("REFERENCE")}
        />
      </SessionManager>
    );
  }

  if (activeView === "REFERENCE") {
    return (
      <SessionManager onReset={() => setActiveView("WELCOME")}>
        <KioskReferenceEntry
          onCancel={() => setActiveView("WELCOME")}
          onSwitchToScanner={() => setActiveView("SCANNER")}
        />
      </SessionManager>
    );
  }

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      width: "100vw",
      height: "100svh",
      margin: 0,
      background: "#0C3B27",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
    }}>
      <WelcomeScreen 
        onStart={() => router.push("/kiosk/reserve")} 
        onOpenScanner={() => setActiveView("SCANNER")}
        onOpenReference={() => setActiveView("REFERENCE")}
      />
    </div>
  );
}
