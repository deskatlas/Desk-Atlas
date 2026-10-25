"use client";
// MS83-R04 / DSD-UI1: shared reservation geometry, desk rendering and controls.
import type { ReactNode, RefObject } from 'react';
import type { Floor, PublishedFloorMap, PublishedMapElement, WorkspaceStatusColors } from '@deskatlas/domain';
import type { WorkspaceMapViewModel } from '@/features/workspace-discovery';
import { MarqueeLabel } from '@deskatlas/ui';
interface ReservationMapProps {
  floors: Floor[]; floorId: string; handleFloorChange: (id: string) => void;
  mapLoading: boolean; published: PublishedFloorMap | null; elements: PublishedMapElement[];
  statusColors: WorkspaceStatusColors; zoom: number;
  handleZoomOut: () => void; handleZoomIn: () => void; handleFitView: () => void;
  mapContainerRef: RefObject<HTMLDivElement | null>; canvasRef: RefObject<HTMLDivElement | null>;
  canvasDimensions: { width: number; height: number; gridSize: number };
  selectedWorkspaceId: string | null; activeRank: number;
  mainCandidate?: { workspace: { templateId: string; templateName: string } } | null;
  workspaces: WorkspaceMapViewModel[]; handleSpotClick: (workspace: WorkspaceMapViewModel) => void;
  isSelectable?: (id: string) => boolean; children?: ReactNode;
}
function getContrastColor(hexColor?: string): string {
  if (!hexColor || !hexColor.startsWith("#") || hexColor.length < 7) return "#111827";
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? "#111827" : "#ffffff";
}

function formatStructureLabel(raw?: string | null): string {
  if (!raw || !raw.trim()) return "Structure";
  const cleaned = raw.replace(/[_-]+/g, " ").trim();
  if (!cleaned) return "Structure";
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function AmenityIcon({ type, name, color }: { type?: string; name?: string; color?: string }) {
  const norm = (type || name || "").toLowerCase();
  const iconColor = color || "#1e293b";

  if (
    norm.includes("restroom") ||
    norm.includes("toilet") ||
    norm.includes("bath") ||
    norm.includes("cr") ||
    norm.includes("washroom")
  ) {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke={iconColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="Restroom"
      >
        <circle cx="8" cy="5" r="2" fill={iconColor} stroke="none" />
        <path d="M8 8v6M6 10h4M7 14v6M9 14v6" stroke={iconColor} strokeWidth="1.75" />
        <circle cx="16" cy="5" r="2" fill={iconColor} stroke="none" />
        <path d="M14 10l2-2 2 2M16 8v3M14 14l1-3h2l1 3M15 14v6M17 14v6" stroke={iconColor} strokeWidth="1.75" />
      </svg>
    );
  }

  if (
    norm.includes("pantry") ||
    norm.includes("kitchen") ||
    norm.includes("dining") ||
    norm.includes("cafe") ||
    norm.includes("coffee") ||
    norm.includes("snack")
  ) {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke={iconColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="Pantry"
      >
        <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
        <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
        <line x1="6" y1="1" x2="6" y2="4" />
        <line x1="10" y1="1" x2="10" y2="4" />
        <line x1="14" y1="1" x2="14" y2="4" />
      </svg>
    );
  }

  if (norm.includes("exit") || norm.includes("emergency")) {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke={iconColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="Emergency Exit"
      >
        <path d="M13 4h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
        <path d="M3 12h11" />
        <path d="M10 8l4 4-4 4" />
        <circle cx="6" cy="7" r="1.5" fill={iconColor} stroke="none" />
        <path d="M6 9v3l-2 2" stroke={iconColor} strokeWidth="1.75" />
      </svg>
    );
  }

  if (norm.includes("door")) {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke={iconColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="Doorway"
      >
        <path d="M18 20V6a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14" />
        <path d="M2 20h20" />
        <circle cx="14" cy="12" r="1" fill={iconColor} />
      </svg>
    );
  }

  if (norm.includes("window")) {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke={iconColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="Window"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="12" y1="3" x2="12" y2="21" />
      </svg>
    );
  }

  if (norm.includes("stair")) {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke={iconColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="Stairs"
      >
        <path d="M19 5h-4v4h-4v4H7v4H3v2h18V5z" />
      </svg>
    );
  }

  return null;
}

export function ReservationMap({ floors, floorId, handleFloorChange, mapLoading, published, elements, statusColors, zoom, handleZoomOut, handleZoomIn, handleFitView, mapContainerRef, canvasRef, canvasDimensions, selectedWorkspaceId, activeRank, mainCandidate, workspaces, handleSpotClick, isSelectable, children }: ReservationMapProps) {
return (<section className="min-w-0 w-full rounded-[28px] border border-[var(--da-border)] bg-white p-4 sm:p-6 shadow-[var(--da-shadow-lg)]">
                  {/* Controls Bar */}
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-4 border-b border-[var(--da-border-light)] pb-4">
                    {/* Floor Selector */}
                    <div className="flex flex-wrap items-center gap-3">
                      <label htmlFor="floor-select" className="text-sm font-bold text-[var(--da-text-primary)]">
                        Floor:
                      </label>
                      {floors.length > 0 ? (
                        <select
                          id="floor-select"
                          value={floorId}
                          onChange={(e) => handleFloorChange(e.target.value)}
                          className="da-input max-w-xs text-sm font-semibold py-2"
                        >
                          {floors.map((floor) => (
                            <option key={floor.id} value={floor.id}>
                              {floor.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-sm text-[var(--da-text-secondary)]">
                          {mapLoading ? "Loading floors..." : "No published floors"}
                        </span>
                      )}
                    </div>

                    {/* Map Controls & Status Legend */}
                    <div className="flex flex-wrap items-center gap-3">
                      {/* Status Legend */}
                      <div className="hidden sm:flex items-center gap-3 text-xs font-semibold text-[var(--da-text-secondary)] border-r border-[var(--da-border-light)] pr-3">
                        <span className="inline-flex items-center gap-1">
                          <span className="h-3 w-3 rounded border" style={{ backgroundColor: statusColors.available, borderColor: statusColors.available }} /> Available
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="h-3 w-3 rounded border" style={{ backgroundColor: statusColors.maintenance, borderColor: statusColors.maintenance }} /> Maintenance
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="h-3 w-3 rounded border" style={{ backgroundColor: statusColors.unavailable, borderColor: statusColors.unavailable }} /> Unavailable
                        </span>
                      </div>

                      {/* Zoom Controls */}
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={handleZoomOut}
                          className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--da-border)] bg-white text-base font-bold text-[var(--da-text-primary)] hover:bg-slate-50 transition"
                          aria-label="Zoom out"
                        >
                          −
                        </button>
                        <span className="w-12 text-center text-xs font-bold text-[var(--da-text-secondary)]">
                          {Math.round(zoom * 100)}%
                        </span>
                        <button
                          type="button"
                          onClick={handleZoomIn}
                          className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--da-border)] bg-white text-base font-bold text-[var(--da-text-primary)] hover:bg-slate-50 transition"
                          aria-label="Zoom in"
                        >
                          +
                        </button>
                        <button
                          type="button"
                          onClick={handleFitView}
                          className="rounded-xl border border-[var(--da-border)] bg-white px-3 py-2 text-xs font-bold text-[var(--da-brand-dark)] hover:bg-slate-50 transition"
                        >
                          Fit View
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Map Viewport Area */}
                  <div
                    ref={mapContainerRef}
                    className="relative w-full rounded-none border border-[var(--da-border-light)] bg-white overflow-auto min-h-[500px] sm:min-h-[580px] max-h-[75vh]"
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "flex-start",
                      position: "relative",
                      padding: 0,
                    }}
                  >
                    {mapLoading ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center bg-white z-10">
                        <div className="h-8 w-8 animate-spin rounded-full border-3 border-[var(--da-primary)] border-t-transparent" />
                        <p className="text-sm font-semibold text-[var(--da-text-secondary)]">
                          Loading published floor map...
                        </p>
                      </div>
                    ) : !published || elements.length === 0 ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center bg-white z-10">
                        <div className="rounded-2xl border border-[var(--da-border)] bg-white p-8 max-w-md shadow-[var(--da-shadow-md)]">
                          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--da-info)] text-2xl">
                            🗺️
                          </div>
                          <h2 className="mt-4 text-lg font-extrabold text-[var(--da-brand-dark)]">
                            No workspaces published on this floor
                          </h2>
                          <p className="mt-2 text-xs leading-5 text-[var(--da-text-secondary)]">
                            Please select another floor or check back once the layout is published.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div
                        style={{
                          width: `${canvasDimensions.width * zoom}px`,
                          height: `${canvasDimensions.height * zoom}px`,
                          minWidth: "100%",
                          minHeight: "100%",
                          position: "relative",
                          flexShrink: 0,
                          background: "#fff",
                        }}
                      >
                        <div
                          ref={canvasRef}
                          style={{
                            width: `${canvasDimensions.width}px`,
                            height: `${canvasDimensions.height}px`,
                            position: "absolute",
                            top: 0,
                            left: 0,
                            background: "#fff",
                            borderRadius: "0px",
                            boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
                            transform: `scale(${zoom})`,
                            transformOrigin: "top left",
                            backgroundImage: "radial-gradient(var(--da-border) 1px, transparent 1px)",
                            backgroundSize: `${canvasDimensions.gridSize}px ${canvasDimensions.gridSize}px`,
                            overflow: "hidden",
                          }}
                        >
                          {elements.map((el: PublishedMapElement) => {
                            const isWorkspace = el.elementRole === "WORKSPACE" || Boolean(el.workspace);
                            if (isWorkspace && el.workspace?.operationalStatus === "INACTIVE") {
                              return null;
                            }
                            const isWall =
                              !isWorkspace &&
                              (el.elementType?.toLowerCase().includes("wall") ||
                                el.elementType?.toLowerCase().includes("thin_wall") ||
                                el.elementType?.toLowerCase().includes("glass") ||
                                el.elementType?.toLowerCase().includes("separator") ||
                                el.label?.toLowerCase().includes("wall") ||
                                el.label?.toLowerCase().includes("separator"));

                            const isWindow =
                              !isWorkspace &&
                              (el.elementType?.toLowerCase().includes("window") ||
                                el.label?.toLowerCase().includes("window"));
                            const isStairs =
                              !isWorkspace &&
                              (el.elementType?.toLowerCase().includes("stairs") ||
                                el.elementType?.toLowerCase().includes("stair") ||
                                el.label?.toLowerCase().includes("stairs"));

                            const isRestroom =
                              el.elementType?.toLowerCase().includes("restroom") ||
                              el.label?.toLowerCase().includes("restroom");
                            const isPantry =
                              el.elementType?.toLowerCase().includes("pantry") ||
                              el.label?.toLowerCase().includes("pantry");
                            const isEmergencyExit =
                              el.elementType?.toLowerCase().includes("exit") ||
                              el.elementType?.toLowerCase().includes("emergency") ||
                              el.label?.toLowerCase().includes("exit") ||
                              el.label?.toLowerCase().includes("emergency");
                            const isAmenity =
                              el.elementRole === "AMENITY" || isRestroom || isPantry || isEmergencyExit;
                            const isKioskMarker =
                              el.elementType === "KIOSK_YOU_ARE_HERE" ||
                              el.style?.markerType === "KIOSK_YOU_ARE_HERE" ||
                              el.label?.toLowerCase() === "you are here" ||
                              el.label?.toLowerCase().includes("kiosk");

                            if (isKioskMarker) {
                              return (
                                <div
                                  key={el.id}
                                  style={{
                                    position: "absolute",
                                    left: el.x,
                                    top: el.y,
                                    width: el.width,
                                    height: el.height,
                                    transform: `rotate(${el.rotation || 0}deg)`,
                                    zIndex: el.zIndex || 20,
                                    pointerEvents: "none",
                                  }}
                                >
                                  <div
                                    style={{
                                      width: "100%",
                                      height: "100%",
                                      display: "flex",
                                      flexDirection: "column",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      gap: "2px",
                                      background: "#DC2626",
                                      color: "#ffffff",
                                      borderRadius: "14px",
                                      border: "2px solid #ffffff",
                                      boxShadow: "0 4px 12px rgba(220, 38, 38, 0.35)",
                                      padding: "4px",
                                      textAlign: "center",
                                    }}
                                  >
                                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="You Are Here">
                                      <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z" fill="#ffffff" stroke="#DC2626" strokeWidth="1.5" />
                                      <circle cx="12" cy="10" r="3" fill="#DC2626" />
                                    </svg>
                                    <span style={{ fontSize: "10px", fontWeight: 800, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#ffffff", textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>
                                      {el.label || "You Are Here"}
                                    </span>
                                  </div>
                                </div>
                              );
                            }

                            let defaultAmenityColor = "#F3F7F4";
                            if (isRestroom) defaultAmenityColor = "#E0F2FE";
                            else if (isPantry) defaultAmenityColor = "#FEF3C7";
                            else if (isEmergencyExit) defaultAmenityColor = "#DCFCE7";

                            const displayName =
                              el.workspace?.displayName ||
                              el.label ||
                              el.workspace?.templateName ||
                              formatStructureLabel(el.elementType);
                            const itemColor =
                              el.style?.color ||
                              el.style?.fillColor ||
                              (isWorkspace
                                ? "#E0EFE4"
                                : isAmenity
                                  ? defaultAmenityColor
                                  : isWall
                                    ? "#334155"
                                    : isWindow
                                      ? "rgba(56, 189, 248, 0.25)"
                                      : isStairs
                                        ? "#E2E8F0"
                                        : "#F3F7F4");

                            let bg = String(itemColor);
                            let textColor = isWindow ? "#0284C7" : isStairs ? "#334155" : getContrastColor(bg);

                            if (isWorkspace) {
                              const isSelected =
                                el.workspace?.workspaceInstanceId === selectedWorkspaceId;
                              const status = el.workspace?.operationalStatus || "ACTIVE";
                              const isBookable = el.workspace?.isBookable ?? true;
                              const isAvailable = isBookable && status === "ACTIVE" && (isSelectable?.(el.workspace?.workspaceInstanceId || "") ?? true);
                              const isMatchingTemplate =
                                !mainCandidate ||
                                el.workspace?.templateId === mainCandidate.workspace.templateId;

                              let borderColor = isSelected ? "var(--da-accent)" : "#DCE6DF";
                              let borderWidth = isSelected ? "3px" : "1.5px";
                              let borderStyle = "solid";

                              if (status === "MAINTENANCE") {
                                borderStyle = "dashed";
                                borderColor = statusColors.maintenance;
                                bg = statusColors.maintenance;
                                textColor = getContrastColor(bg);
                              } else if (!isAvailable) {
                                borderStyle = "dashed";
                                borderColor = statusColors.unavailable;
                                bg = statusColors.unavailable;
                                textColor = getContrastColor(bg);
                              } else if (activeRank > 0 && !isMatchingTemplate) {
                                borderStyle = "dashed";
                                borderColor = "#cbd5e1";
                                bg = "#f8fafc";
                                textColor = "#94a3b8";
                              } else {
                                bg = statusColors.available;
                                textColor = getContrastColor(bg);
                              }

                              const wsModel = workspaces.find(
                                (w) => w.workspaceInstanceId === el.workspace?.workspaceInstanceId
                              );

                              return (
                                <div
                                  key={el.id}
                                  style={{
                                    position: "absolute",
                                    left: el.x,
                                    top: el.y,
                                    width: el.width,
                                    height: el.height,
                                    transform: `rotate(${el.rotation || 0}deg)`,
                                    zIndex: isSelected ? 15 : el.zIndex || 5,
                                  }}
                                >
                                  <button
                                    type="button"
                                    aria-label={displayName}
                                    disabled={!isAvailable}
                                    onClick={() => {
                                      if (wsModel && isAvailable) handleSpotClick(wsModel);
                                    }}
                                    className="group h-full w-full flex flex-col items-center justify-center p-1 text-center transition-all duration-150 relative hover:scale-[1.03] active:scale-[0.98]"
                                    style={{
                                      backgroundColor: bg,
                                      borderWidth,
                                      borderStyle,
                                      borderColor,
                                      borderRadius: el.elementType === "meeting-room" ? "16px" : "10px",
                                      color: textColor,
                                      cursor: isAvailable ? "pointer" : "not-allowed",
                                      opacity: isAvailable ? (activeRank > 0 && !isMatchingTemplate ? 0.6 : 1) : 0.75,
                                      boxShadow: isSelected
                                        ? "0 0 0 4px rgba(200, 244, 81, 0.4), 0 4px 12px rgba(12, 59, 39, 0.15)"
                                        : "0 1px 3px rgba(0, 0, 0, 0.05)",
                                    }}
                                  >
                                    <MarqueeLabel
                                      text={displayName}
                                      style={{ fontSize: "11px", fontWeight: 700, lineHeight: 1.2, maxWidth: "100%" }}
                                    />
                                  </button>
                                </div>
                              );
                            }

                            if (isWall) {
                              return (
                                <div
                                  key={el.id}
                                  style={{
                                    position: "absolute",
                                    left: el.x,
                                    top: el.y,
                                    width: el.width,
                                    height: el.height,
                                    transform: `rotate(${el.rotation || 0}deg)`,
                                    zIndex: el.zIndex || 1,
                                    backgroundColor: bg,
                                    borderRadius: "2px",
                                    pointerEvents: "none",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    overflow: "hidden",
                                    color: textColor,
                                    boxSizing: "border-box",
                                  }}
                                >
                                  <span
                                    style={{
                                      maxWidth: "100%",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                      fontSize: el.height <= 20 ? "9px" : "11px",
                                      fontWeight: el.height <= 20 ? 800 : 700,
                                      letterSpacing: el.height <= 20 ? "0.05em" : "normal",
                                      textTransform: el.height <= 20 ? "uppercase" : "none",
                                      padding: "0 4px",
                                      lineHeight: 1,
                                    }}
                                  >
                                    {displayName}
                                  </span>
                                </div>
                              );
                            }

                            if (isAmenity) {
                              return (
                                <div
                                  key={el.id}
                                  style={{
                                    position: "absolute",
                                    left: el.x,
                                    top: el.y,
                                    width: el.width,
                                    height: el.height,
                                    transform: `rotate(${el.rotation || 0}deg)`,
                                    zIndex: el.zIndex || 2,
                                    backgroundColor: bg,
                                    borderRadius: "8px",
                                    border: "1px solid rgba(0, 0, 0, 0.1)",
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    textAlign: "center",
                                    padding: "4px",
                                    pointerEvents: "none",
                                    color: textColor,
                                  }}
                                >
                                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "3px", maxWidth: "100%", maxHeight: "100%", textAlign: "center" }}>
                                    <AmenityIcon type={el.elementType} name={displayName} color={textColor} />
                                    <span style={{ fontSize: "10px", fontWeight: 700, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: 0.9, textAlign: "center" }}>
                                      {displayName}
                                    </span>
                                  </div>
                                </div>
                              );
                            }

                            if (isWindow) {
                              return (
                                <div
                                  key={el.id}
                                  style={{
                                    position: "absolute",
                                    left: el.x,
                                    top: el.y,
                                    width: el.width,
                                    height: el.height,
                                    transform: `rotate(${el.rotation || 0}deg)`,
                                    zIndex: el.zIndex || 1,
                                    backgroundColor: bg,
                                    borderRadius: "2px",
                                    border: "1.5px solid #38BDF8",
                                    pointerEvents: "none",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    overflow: "hidden",
                                    boxSizing: "border-box",
                                  }}
                                >
                                  <div style={{ position: "absolute", inset: "1px", border: "1px solid rgba(56, 189, 248, 0.4)", borderRadius: "1px", pointerEvents: "none" }} />
                                  <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: "1px", background: "rgba(56, 189, 248, 0.7)", transform: "translateY(-50%)", pointerEvents: "none" }} />
                                  <div style={{ position: "absolute", top: 0, bottom: 0, left: "33.3%", width: "1px", background: "rgba(56, 189, 248, 0.6)", pointerEvents: "none" }} />
                                  <div style={{ position: "absolute", top: 0, bottom: 0, left: "66.6%", width: "1px", background: "rgba(56, 189, 248, 0.6)", pointerEvents: "none" }} />
                                  <span
                                    style={{
                                      position: "relative",
                                      zIndex: 1,
                                      fontSize: "9px",
                                      fontWeight: 800,
                                      color: "#0284C7",
                                      letterSpacing: "0.05em",
                                      textTransform: "uppercase",
                                      pointerEvents: "none",
                                      padding: "0 4px",
                                      lineHeight: 1,
                                      maxWidth: "100%",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {displayName}
                                  </span>
                                </div>
                              );
                            }

                            if (isStairs) {
                              return (
                                <div
                                  key={el.id}
                                  style={{
                                    position: "absolute",
                                    left: el.x,
                                    top: el.y,
                                    width: el.width,
                                    height: el.height,
                                    transform: `rotate(${el.rotation || 0}deg)`,
                                    zIndex: el.zIndex || 1,
                                    backgroundColor: bg,
                                    borderRadius: "4px",
                                    border: "1.5px solid #94A3B8",
                                    pointerEvents: "none",
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    overflow: "hidden",
                                    padding: "4px",
                                    boxSizing: "border-box",
                                  }}
                                >
                                  <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", opacity: 0.75 }} xmlns="http://www.w3.org/2000/svg">
                                    <defs>
                                      <pattern id={`stairs-pattern-cust-${el.id}`} width="100%" height="16" patternUnits="userSpaceOnUse">
                                        <line x1="0" y1="16" x2="100%" y2="16" stroke="#94A3B8" strokeWidth="1.5" />
                                      </pattern>
                                    </defs>
                                    <rect width="100%" height="100%" fill={`url(#stairs-pattern-cust-${el.id})`} />
                                    <line x1="50%" y1="85%" x2="50%" y2="20%" stroke="#64748B" strokeWidth="2" strokeLinecap="round" />
                                    <polyline points="calc(50% - 6px),30% 50%,18% calc(50% + 6px),30%" fill="none" stroke="#64748B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                  <div style={{ position: "relative", zIndex: 1, background: "rgba(255, 255, 255, 0.9)", padding: "2px 6px", borderRadius: "4px", border: "1px solid #CBD5E1", display: "flex", alignItems: "center", gap: "4px", maxWidth: "90%" }}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M19 5h-4v4h-4v4H7v4H3v2h18V5z" />
                                    </svg>
                                    <span style={{ fontSize: "10px", fontWeight: 800, color: "#334155", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                      {displayName}
                                    </span>
                                  </div>
                                </div>
                              );
                            }

                            const borderStyle = el.style?.borderStyle;
                            let structureBorder = "1px solid rgba(0, 0, 0, 0.15)";
                            if (borderStyle === "dashed") {
                              structureBorder = "1.5px dashed var(--da-border, #CBD5E1)";
                            } else if (borderStyle === "none") {
                              structureBorder = "none";
                            } else if (el.elementType?.toLowerCase().includes("door")) {
                              structureBorder = "2px dashed var(--da-brand-dark, #0C3B27)";
                            }

                            return (
                              <div
                                key={el.id}
                                style={{
                                  position: "absolute",
                                  left: el.x,
                                  top: el.y,
                                  width: el.width,
                                  height: el.height,
                                  transform: `rotate(${el.rotation || 0}deg)`,
                                  zIndex: el.zIndex || 1,
                                  backgroundColor: bg,
                                  borderRadius: "8px",
                                  border: structureBorder,
                                  pointerEvents: "none",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  overflow: "hidden",
                                  color: textColor,
                                  boxSizing: "border-box",
                                }}
                              >
                                <span
                                  style={{
                                    maxWidth: "100%",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                    fontSize: el.height <= 20 ? "9px" : "11px",
                                    fontWeight: el.height <= 20 ? 800 : 700,
                                    letterSpacing: el.height <= 20 ? "0.05em" : "normal",
                                    textTransform: el.height <= 20 ? "uppercase" : "none",
                                    padding: "0 4px",
                                    lineHeight: 1,
                                  }}
                                >
                                  {displayName}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

{children}
</section>);
}
