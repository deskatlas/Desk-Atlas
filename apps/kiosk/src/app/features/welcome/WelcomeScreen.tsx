"use client";

interface WelcomeScreenProps {
  onStart: () => void;
  onOpenScanner: () => void;
  onOpenReference?: () => void;
}

export function WelcomeScreen({ onStart, onOpenScanner, onOpenReference }: WelcomeScreenProps) {
  return (
    <div style={{ width: "100%", height: "100%", minHeight: 0, position: "relative", overflow: "hidden", background: "#0C3B27" }}>
      <button 
        onClick={onStart} 
        data-screen-label="Kiosk Idle" 
        style={{
          all: "unset", width: "100%", height: "100%", minHeight: 0, display: "flex", 
          flexDirection: "column", alignItems: "center", justifyContent: "center", 
          background: "#0C3B27", cursor: "pointer", textAlign: "center",
          boxSizing: "border-box", padding: "48px"
        }}
      >
        <div style={{
          width: "88px", height: "88px", borderRadius: "22px", background: "#C8F451", 
          display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "36px"
        }}>
          <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: "#0C3B27" }}></div>
        </div>
        <div style={{ fontSize: "56px", fontWeight: 800, color: "#fff", letterSpacing: "-0.02em", marginBottom: "16px" }}>
          DeskAtlas
        </div>
        <div style={{ fontSize: "26px", color: "rgba(255,255,255,.75)", marginBottom: "60px" }}>
          Ground Floor Self-Service Kiosk
        </div>
        <div style={{
          fontSize: "32px", fontWeight: 800, color: "#C8F451", padding: "22px 52px", 
          border: "3px solid #C8F451", borderRadius: "9999px",
          minHeight: "44px", display: "flex", alignItems: "center", justifyContent: "center"
        }}>
          Tap to Begin
        </div>
      </button>
      
      {/* Existing reservations actions */}
      <div 
        style={{
          position: "absolute", bottom: "30px", right: "30px",
          display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end",
          zIndex: 10
        }}
      >
        {onOpenReference && (
          <button 
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenReference();
            }}
            style={{
              background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.32)",
              color: "#FFFFFF", padding: "12px 24px", borderRadius: "9999px",
              fontSize: "16px", fontWeight: 700, cursor: "pointer",
              backdropFilter: "blur(6px)", transition: "all 0.15s ease"
            }}
          >
            Enter Reference ID
          </button>
        )}
        <button 
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenScanner();
          }}
          style={{
            background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.32)",
            color: "#FFFFFF", padding: "12px 24px", borderRadius: "9999px",
            fontSize: "16px", fontWeight: 700, cursor: "pointer",
            backdropFilter: "blur(6px)", transition: "all 0.15s ease"
          }}
        >
          Scan QR
        </button>
      </div>
    </div>
  );
}
