"use client";

import React, { useState, useRef, useEffect } from "react";

export interface ProfileUser {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  isSuperAdmin?: boolean | null;
}

export interface ProfileDropdownProps {
  user: ProfileUser | null;
  onLogout: () => void | Promise<void>;
  className?: string;
  style?: React.CSSProperties;
}

function ChevronDownIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        display: "block",
        flexShrink: 0,
        transition: "transform 0.2s ease",
        transform: open ? "rotate(180deg)" : "rotate(0deg)",
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function LogOutIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

export function ProfileDropdown({
  user,
  onLogout,
  className,
  style,
}: ProfileDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isHoveredLogout, setIsHoveredLogout] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  if (!user) {
    return null;
  }

  const initialChar = (user.name?.[0] || user.role?.[0] || "U").toUpperCase();
  const displayName = user.name || "User";
  const displayEmail = user.email || "";

  // Compute role badge formatting
  const isSuperAdmin = Boolean(user.isSuperAdmin);
  const roleLower = (user.role || "").toLowerCase();
  let roleLabel = "Staff";
  let badgeBg = "#F3F4F6";
  let badgeColor = "#4B5563";

  if (isSuperAdmin) {
    roleLabel = "Superadmin";
    badgeBg = "#FEF3C7";
    badgeColor = "#B45309";
  } else if (roleLower === "admin") {
    roleLabel = "Admin";
    badgeBg = "#E0F2FE";
    badgeColor = "#0369A1";
  } else {
    roleLabel = "Staff";
    badgeBg = "#F3F4F6";
    badgeColor = "#4B5563";
  }

  const handleTriggerClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen((prev) => !prev);
  };

  const handleLogoutClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(false);
    onLogout();
  };

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: "relative",
        ...style,
      }}
    >
      {/* Profile Trigger */}
      <div
        data-testid="profile-dropdown-trigger"
        role="button"
        tabIndex={0}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={handleTriggerClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsOpen((prev) => !prev);
          }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "9px",
          paddingLeft: "14px",
          borderLeft: "1px solid var(--da-border, #e5e7eb)",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <div
          style={{
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            background: "var(--da-brand-dark, #0f172a)",
            color: "var(--da-brand-accent, #009689)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "12px",
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          {initialChar}
        </div>
        <div style={{ minWidth: 0, textAlign: "left" }}>
          <div
            style={{
              fontSize: "12px",
              fontWeight: 700,
              color: "var(--da-text-primary, #111827)",
              lineHeight: 1.2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {displayName}
          </div>
          <div
            style={{
              fontSize: "10px",
              color: "var(--da-text-secondary, #6b7280)",
              fontFamily: "var(--da-font-family)",
              textTransform: "capitalize",
              lineHeight: 1.2,
            }}
          >
            {roleLabel}
          </div>
        </div>
        <div style={{ color: "var(--da-text-secondary, #6b7280)", marginLeft: "2px" }}>
          <ChevronDownIcon open={isOpen} />
        </div>
      </div>

      {/* Floating Dropdown Card */}
      {isOpen && (
        <div
          data-testid="profile-dropdown-menu"
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: "240px",
            background: "#ffffff",
            border: "1px solid var(--da-border, #e5e7eb)",
            borderRadius: "12px",
            boxShadow:
              "var(--da-shadow-md, 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05))",
            padding: "12px",
            zIndex: 50,
            fontFamily: "var(--da-font-family)",
            boxSizing: "border-box",
          }}
        >
          {/* Identity Section */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "10px",
              paddingBottom: "10px",
            }}
          >
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "50%",
                background: "var(--da-brand-dark, #0f172a)",
                color: "var(--da-brand-accent, #009689)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "13px",
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              {initialChar}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: 700,
                  color: "var(--da-brand-dark, #0f172a)",
                  lineHeight: 1.3,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={displayName}
              >
                {displayName}
              </div>
              {displayEmail ? (
                <div
                  style={{
                    fontSize: "11px",
                    color: "var(--da-text-secondary, #6b7280)",
                    marginTop: "2px",
                    lineHeight: 1.3,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={displayEmail}
                >
                  {displayEmail}
                </div>
              ) : null}
              <div style={{ marginTop: "6px" }}>
                <span
                  data-testid="profile-role-badge"
                  style={{
                    display: "inline-block",
                    padding: "2px 6px",
                    borderRadius: "4px",
                    fontSize: "10px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.03em",
                    background: badgeBg,
                    color: badgeColor,
                    lineHeight: 1.2,
                  }}
                >
                  {isSuperAdmin ? "SUPERADMIN" : (user.role?.toUpperCase() || "STAFF")}
                </span>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div
            style={{
              borderTop: "1px solid var(--da-border, #e5e7eb)",
              margin: "4px 0 8px 0",
            }}
          />

          {/* Logout Action */}
          <button
            type="button"
            data-testid="profile-logout-btn"
            role="menuitem"
            onClick={handleLogoutClick}
            onMouseEnter={() => setIsHoveredLogout(true)}
            onMouseLeave={() => setIsHoveredLogout(false)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 10px",
              borderRadius: "8px",
              border: "none",
              background: isHoveredLogout ? "#FEE2E2" : "transparent",
              color: "#DC2626",
              fontSize: "12px",
              fontWeight: 600,
              fontFamily: "var(--da-font-family)",
              cursor: "pointer",
              textAlign: "left",
              transition: "background 0.15s ease",
            }}
          >
            <LogOutIcon />
            <span>Logout</span>
          </button>
        </div>
      )}
    </div>
  );
}
