"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/app/components/ui/dialog";
import {
  type WorkspaceMapViewModel,
  getWorkspacePhotoObjectPosition,
} from "@/features/workspace-discovery";

interface SpotDetailModalProps {
  workspace: WorkspaceMapViewModel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProceed: (workspace: WorkspaceMapViewModel) => void;
  candidateRank?: 0 | 1 | 2;
  mainTemplateName?: string;
}

export function SpotDetailModal({
  workspace,
  open,
  onOpenChange,
  onProceed,
  candidateRank = 0,
  mainTemplateName,
}: SpotDetailModalProps) {
  const [imageError, setImageError] = useState(false);

  if (!workspace) return null;

  const isAvailable = workspace.status === "available";

  const getStatusBadgeStyle = () => {
    switch (workspace.status) {
      case "available":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "maintenance":
        return "bg-amber-50 text-amber-800 border-amber-200";
      default:
        return "bg-slate-100 text-slate-700 border-slate-200";
    }
  };

  const handleProceed = () => {
    if (!isAvailable) return;
    onProceed(workspace);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg sm:max-w-xl max-h-[90vh] overflow-y-auto rounded-[24px] border border-[var(--da-border)] bg-white p-6 shadow-2xl"
        aria-describedby="spot-detail-description"
      >
        <DialogHeader className="text-left space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2 pr-6">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider ${getStatusBadgeStyle()}`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${isAvailable
                      ? "bg-emerald-500"
                      : workspace.status === "maintenance"
                        ? "bg-amber-500"
                        : "bg-slate-400"
                    }`}
                />
                {workspace.statusLabel}
              </span>
              {candidateRank > 0 ? (
                <span className="rounded-md bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs font-extrabold text-amber-800">
                  Backup Spot {candidateRank} Candidate
                </span>
              ) : null}
            </div>
            <span className="text-xs font-semibold text-[var(--da-text-secondary)]">
              {workspace.floorName}
            </span>
          </div>

          <DialogTitle className="text-2xl font-extrabold tracking-tight text-[var(--da-brand-dark)]">
            {workspace.displayName}
          </DialogTitle>

          <DialogDescription id="spot-detail-description" className="text-xs font-medium text-[var(--da-text-secondary)]">
            {workspace.templateName} • {workspace.floorName}
          </DialogDescription>
        </DialogHeader>

        {/* Workspace Photo / Fallback Banner */}
        <div className="relative mt-2 overflow-hidden rounded-[18px] border border-[var(--da-border-light)] bg-[var(--da-canvas)]">
          {workspace.photoPath && !imageError ? (
            <div className="relative aspect-[16/9] w-full bg-slate-100">
              <img
                src={workspace.photoPath}
                alt={workspace.displayName}
                onError={() => setImageError(true)}
                className="h-full w-full object-cover"
                style={{
                  objectPosition: getWorkspacePhotoObjectPosition(workspace.photoPosition),
                }}
              />
            </div>
          ) : (
            <div className="flex aspect-[16/9] w-full flex-col items-center justify-center p-6 text-center bg-gradient-to-br from-[#E0EFE4]/60 to-[#F3F7F4]">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm border border-[var(--da-border-light)] text-2xl text-[var(--da-primary)]">
                🏢
              </div>
              <p className="mt-3 text-sm font-bold text-[var(--da-brand-dark)]">
                {workspace.templateName}
              </p>
              <p className="mt-0.5 text-xs text-[var(--da-text-secondary)] font-medium">
                DeskAtlas Published Workspace
              </p>
            </div>
          )}
        </div>

        {/* Key Metrics Grid */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-[16px] border border-[var(--da-border-light)] bg-[var(--da-canvas)] p-3 text-center">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--da-text-secondary)]">
              Hourly Rate
            </span>
            <p className="mt-1 text-base font-extrabold text-[var(--da-brand-dark)]">
              ₱{workspace.rateAmount}
              <span className="text-xs font-semibold text-[var(--da-text-secondary)]">/hr</span>
            </p>
          </div>

          <div className="rounded-[16px] border border-[var(--da-border-light)] bg-[var(--da-canvas)] p-3 text-center">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--da-text-secondary)]">
              Capacity
            </span>
            <p className="mt-1 text-base font-extrabold text-[var(--da-brand-dark)]">
              {workspace.capacity}{" "}
              <span className="text-xs font-semibold text-[var(--da-text-secondary)]">
                {workspace.capacity === 1 ? "seat" : "seats"}
              </span>
            </p>
          </div>

          <div className="rounded-[16px] border border-[var(--da-border-light)] bg-[var(--da-canvas)] p-3 text-center">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--da-text-secondary)]">
              Type
            </span>
            <p className="mt-1 max-w-full truncate text-base font-extrabold text-[var(--da-brand-dark)]">
              {workspace.templateName}
            </p>
          </div>
        </div>

        {/* Recommendation Tags */}
        {workspace.tags && workspace.tags.length > 0 ? (
          <div className="mt-3">
            <span className="text-xs font-bold text-[var(--da-text-secondary)] uppercase tracking-wider">
              Highlights
            </span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {workspace.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-[rgba(0,150,137,0.08)] border border-[rgba(0,150,137,0.2)] px-3 py-1 text-xs font-bold text-[var(--da-brand-dark)]"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {/* Description */}
        <div className="mt-3">
          <span className="text-xs font-bold text-[var(--da-text-secondary)] uppercase tracking-wider">
            Description
          </span>
          <p className="mt-1 text-sm leading-relaxed text-[var(--da-text-secondary)] bg-[var(--da-canvas)] p-3.5 rounded-[16px] border border-[var(--da-border-light)]">
            {workspace.description}
          </p>
        </div>

        {/* No-Hold Rule Note */}
        <div className="mt-2 rounded-[14px] bg-slate-50 border border-slate-200 p-3 text-[11px] leading-4 text-slate-600">
          <span className="font-bold text-slate-800">No-Hold Rule:</span> Selecting a spot does not reserve inventory. Spot allocation is finalized upon approved payment confirmation.
        </div>

        {/* Actions Footer */}
        <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-[var(--da-border-light)] pt-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="da-secondary-button px-4 py-2.5 text-xs font-bold"
          >
            Back to Map
          </button>
          <button
            type="button"
            disabled={!isAvailable}
            onClick={handleProceed}
            className={`da-primary-button px-5 py-2.5 text-xs font-bold ${!isAvailable ? "opacity-50 cursor-not-allowed" : ""
              }`}
          >
            {isAvailable ? "Proceed with this Spot →" : "Currently Unavailable"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
