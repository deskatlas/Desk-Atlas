"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Check,
  Calendar,
  DollarSign,
  UserCheck,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  LogOut,
  Clock,
} from "lucide-react";
import { AdminNotificationItem, AdminNotificationType } from "@deskatlas/domain";

const STORAGE_KEY = "deskatlas_admin_read_notifications";

function getStoredReadIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveStoredReadIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // Ignore storage errors
  }
}

function formatRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSec < 45) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function getNotificationConfig(type: AdminNotificationType) {
  switch (type) {
    case "RESERVATION_CREATED":
      return {
        icon: Calendar,
        color: "#009689",
        bgColor: "#e6f7f5",
      };
    case "PAYMENT_PROOF_SUBMITTED":
      return {
        icon: AlertCircle,
        color: "#d97706",
        bgColor: "#fef3c7",
      };
    case "PAYMENT_APPROVED":
      return {
        icon: DollarSign,
        color: "#10b981",
        bgColor: "#d1fae5",
      };
    case "PAYMENT_REJECTED":
      return {
        icon: AlertTriangle,
        color: "#ef4444",
        bgColor: "#fee2e2",
      };
    case "WORKSPACE_STATUS_CHANGED":
      return {
        icon: RefreshCw,
        color: "#8b5cf6",
        bgColor: "#f3e8ff",
      };
    case "CHECK_IN":
      return {
        icon: UserCheck,
        color: "#009689",
        bgColor: "#e6f7f5",
      };
    case "CHECK_OUT":
      return {
        icon: LogOut,
        color: "#6b7280",
        bgColor: "#f3f4f6",
      };
    case "PAYMENT_EXPIRED":
      return {
        icon: Clock,
        color: "#ef4444",
        bgColor: "#fee2e2",
      };
    case "MANUAL_RESOLUTION_REQUIRED":
      return {
        icon: AlertTriangle,
        color: "#ea580c",
        bgColor: "#ffedd5",
      };
    case "ADMIN_INVITATION_ACCEPTED":
      return {
        icon: UserCheck,
        color: "#059669",
        bgColor: "#d1fae5",
      };
    case "STAFF_INVITATION_ACCEPTED":
      return {
        icon: UserCheck,
        color: "#0284c7",
        bgColor: "#e0f2fe",
      };
    default:
      return {
        icon: Bell,
        color: "#009689",
        bgColor: "#e6f7f5",
      };
  }
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AdminNotificationItem[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(() => getStoredReadIds());
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [loading, setLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const fetchNotifications = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/notifications?limit=50", {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.notifications)) {
          setNotifications(data.notifications);
        }
      }
    } catch {
      // Ignore fetch errors
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  // Close dropdown on click outside or escape key
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const unreadCount = notifications.filter(
    (n) => !readIds.has(n.id) && !n.read
  ).length;

  const markSingleAsRead = (id: string, event?: React.MouseEvent) => {
    if (event) {
      event.stopPropagation();
    }
    const next = new Set(readIds);
    next.add(id);
    setReadIds(next);
    saveStoredReadIds(next);
  };

  const markAllAsRead = () => {
    const next = new Set(readIds);
    for (const n of notifications) {
      next.add(n.id);
    }
    setReadIds(next);
    saveStoredReadIds(next);
  };

  const handleNotificationClick = (item: AdminNotificationItem) => {
    markSingleAsRead(item.id);
    setOpen(false);
    if (item.link) {
      router.push(item.link);
    }
  };

  const filteredNotifications = notifications.filter((n) => {
    const isRead = readIds.has(n.id) || !!n.read;
    if (filter === "unread") return !isRead;
    return true;
  });

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      {/* Bell Button (adjacent to timer) */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={`Notifications (${unreadCount} unread)`}
        title={`Notifications (${unreadCount} unread)`}
        style={{
          position: "relative",
          width: "32px",
          height: "32px",
          borderRadius: "9px",
          background: open ? "var(--da-soft, #e6f7f5)" : "var(--da-canvas, #f8f9fa)",
          border: "1px solid var(--da-border, #e5e7eb)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          padding: 0,
          color: open ? "var(--da-primary, #009689)" : "var(--da-text-primary, #111827)",
          transition: "all 0.15s ease",
        }}
      >
        <Bell style={{ width: "15px", height: "15px" }} />
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: "-4px",
              right: "-4px",
              minWidth: "16px",
              height: "16px",
              borderRadius: "9999px",
              background: "#ef4444",
              color: "#ffffff",
              fontSize: "10px",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 4px",
              border: "2px solid #ffffff",
              boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
              lineHeight: 1,
            }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: "380px",
            maxWidth: "calc(100vw - 32px)",
            background: "#ffffff",
            borderRadius: "12px",
            border: "1px solid var(--da-border, #e5e7eb)",
            boxShadow:
              "0 10px 25px -5px rgba(0,0,0,0.12), 0 8px 10px -6px rgba(0,0,0,0.08)",
            zIndex: 100,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            fontFamily: "var(--da-font-family, inherit)",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "14px 16px",
              borderBottom: "1px solid var(--da-border, #e5e7eb)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "#fafafa",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  fontSize: "14px",
                  fontWeight: 700,
                  color: "var(--da-text-primary, #111827)",
                }}
              >
                Notifications
              </span>
              {unreadCount > 0 && (
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    background: "#fee2e2",
                    color: "#dc2626",
                    padding: "2px 6px",
                    borderRadius: "9999px",
                  }}
                >
                  {unreadCount} new
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                style={{
                  background: "transparent",
                  border: "none",
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "var(--da-primary, #009689)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "4px 8px",
                  borderRadius: "6px",
                }}
                title="Mark all as read"
              >
                <Check style={{ width: "12px", height: "12px" }} />
                Mark all as read
              </button>
            )}
          </div>

          {/* Filter Tabs */}
          <div
            style={{
              display: "flex",
              padding: "6px 12px",
              gap: "6px",
              borderBottom: "1px solid var(--da-border, #e5e7eb)",
              background: "#ffffff",
            }}
          >
            <button
              type="button"
              onClick={() => setFilter("all")}
              style={{
                fontSize: "12px",
                fontWeight: 600,
                padding: "4px 10px",
                borderRadius: "6px",
                border: "none",
                cursor: "pointer",
                background: filter === "all" ? "var(--da-primary, #009689)" : "transparent",
                color: filter === "all" ? "#ffffff" : "var(--da-text-secondary, #6b7280)",
              }}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setFilter("unread")}
              style={{
                fontSize: "12px",
                fontWeight: 600,
                padding: "4px 10px",
                borderRadius: "6px",
                border: "none",
                cursor: "pointer",
                background: filter === "unread" ? "var(--da-primary, #009689)" : "transparent",
                color: filter === "unread" ? "#ffffff" : "var(--da-text-secondary, #6b7280)",
              }}
            >
              Unread ({unreadCount})
            </button>
          </div>

          {/* Notifications List */}
          <div
            style={{
              maxHeight: "360px",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {filteredNotifications.length === 0 ? (
              <div
                style={{
                  padding: "36px 20px",
                  textAlign: "center",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  color: "var(--da-text-secondary, #6b7280)",
                }}
              >
                <Bell
                  style={{
                    width: "32px",
                    height: "32px",
                    color: "var(--da-border, #d1d5db)",
                  }}
                />
                <div style={{ fontSize: "13px", fontWeight: 600 }}>
                  {filter === "unread"
                    ? "No unread notifications"
                    : "No new notifications"}
                </div>
                <div style={{ fontSize: "11px", color: "#9ca3af" }}>
                  Operational events will appear here.
                </div>
              </div>
            ) : (
              filteredNotifications.map((item) => {
                const isRead = readIds.has(item.id) || !!item.read;
                const config = getNotificationConfig(item.type);
                const Icon = config.icon;

                return (
                  <div
                    key={item.id}
                    onClick={() => handleNotificationClick(item)}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "12px",
                      padding: "12px 16px",
                      borderBottom: "1px solid #f3f4f6",
                      cursor: "pointer",
                      background: isRead ? "#ffffff" : "rgba(0, 150, 137, 0.04)",
                      transition: "background 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = isRead
                        ? "#f9fafb"
                        : "rgba(0, 150, 137, 0.08)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = isRead
                        ? "#ffffff"
                        : "rgba(0, 150, 137, 0.04)";
                    }}
                  >
                    {/* Event Icon */}
                    <div
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "8px",
                        background: config.bgColor,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        marginTop: "2px",
                      }}
                    >
                      <Icon
                        style={{
                          width: "16px",
                          height: "16px",
                          color: config.color,
                        }}
                      />
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "8px",
                          marginBottom: "2px",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "13px",
                            fontWeight: isRead ? 600 : 700,
                            color: "var(--da-text-primary, #111827)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {item.title}
                        </div>
                        <span
                          style={{
                            fontSize: "11px",
                            color: "var(--da-text-secondary, #9ca3af)",
                            flexShrink: 0,
                          }}
                        >
                          {formatRelativeTime(item.timestamp)}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: "12px",
                          color: "var(--da-text-secondary, #4b5563)",
                          lineHeight: 1.35,
                          marginBottom: "4px",
                        }}
                      >
                        {item.description}
                      </div>
                    </div>

                    {/* Actions / Read Indicator */}
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "6px",
                        flexShrink: 0,
                      }}
                    >
                      {!isRead && (
                        <div
                          style={{
                            width: "7px",
                            height: "7px",
                            borderRadius: "50%",
                            background: "var(--da-primary, #009689)",
                            marginTop: "6px",
                          }}
                        />
                      )}
                      {!isRead && (
                        <button
                          type="button"
                          onClick={(e) => markSingleAsRead(item.id, e)}
                          title="Mark as read"
                          style={{
                            background: "transparent",
                            border: "none",
                            padding: "2px",
                            cursor: "pointer",
                            color: "#9ca3af",
                            borderRadius: "4px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--da-primary, #009689)")}
                          onMouseLeave={(e) => (e.currentTarget.style.color = "#9ca3af")}
                        >
                          <Check style={{ width: "14px", height: "14px" }} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
