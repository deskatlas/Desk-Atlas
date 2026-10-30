'use client';

import React from 'react';
import { Layers, X } from 'lucide-react';

export interface ComparisonSpotInfo {
  workspaceId: string;
  name: string;
  code?: string;
  capacity?: number;
  pricePerHour?: number;
}

export interface ComparisonTrayProps {
  spotIds: string[];
  spotsInfo?: Record<string, ComparisonSpotInfo>;
  onRemoveSpot: (spotId: string) => void;
  onClearAll: () => void;
  onCompareNow: (spotIds: string[]) => void;
  busy?: boolean;
}

export function ComparisonTray({
  spotIds,
  spotsInfo = {},
  onRemoveSpot,
  onClearAll,
  onCompareNow,
  busy = false,
}: ComparisonTrayProps) {
  if (!spotIds || spotIds.length === 0) {
    return null;
  }

  const isCompareReady = spotIds.length >= 2;

  return (
    <div
      data-testid="comparison-tray"
      className="border border-emerald-200 bg-white rounded-2xl p-3.5 shadow-sm space-y-3"
    >
      {/* Top Header Row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
          <span className="text-xs font-bold text-slate-800">
            Workspaces to Compare
          </span>
          <span
            data-testid="comparison-count-badge"
            className="rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold px-2 py-0.5"
          >
            {spotIds.length} of 3
          </span>
        </div>
        <button
          type="button"
          onClick={onClearAll}
          className="text-xs text-slate-500 hover:text-slate-800 underline focus:outline-none"
        >
          Clear all
        </button>
      </div>

      {/* Chip Row */}
      <div className="flex flex-wrap gap-1.5" role="list" aria-label="Comparison workspaces">
        {spotIds.map((id) => {
          const info = spotsInfo[id];
          const displayName = info?.name || info?.code || id;
          const subtitle = info?.capacity
            ? `${info.capacity} ${info.capacity === 1 ? 'seat' : 'seats'}`
            : null;

          return (
            <div
              key={id}
              role="listitem"
              data-testid={`comparison-chip-${id}`}
              className="bg-emerald-50 text-emerald-900 border border-emerald-200 rounded-full px-3 py-1 text-xs font-semibold flex items-center gap-1.5"
            >
              <span className="truncate max-w-[140px]">{displayName}</span>
              {subtitle && (
                <span className="text-[10px] text-emerald-700 font-normal">
                  ({subtitle})
                </span>
              )}
              <button
                type="button"
                onClick={() => onRemoveSpot(id)}
                className="ml-0.5 rounded-full p-0.5 text-emerald-700 hover:text-rose-600 hover:bg-rose-50 transition-colors focus:outline-none"
                aria-label={`Remove ${displayName} from comparison`}
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Action Footer */}
      <div>
        {isCompareReady ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onCompareNow(spotIds)}
            className="da-primary-button w-full text-xs py-2 justify-center"
          >
            Compare These Workspaces
          </button>
        ) : (
          <p className="text-xs text-slate-500 text-center italic">
            Select at least 1 more workspace from the map to compare them side by side.
          </p>
        )}
      </div>
    </div>
  );
}
