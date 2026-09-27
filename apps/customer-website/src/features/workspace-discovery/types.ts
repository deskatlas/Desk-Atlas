export type WorkspaceStatus =
  | "available"
  | "unavailable"
  | "maintenance"
  | "broken"
  | "inactive";

export interface WorkspaceMapViewModel {
  id: string;
  workspaceInstanceId: string;
  templateId: string;
  floorId: string;
  floorName: string;
  instanceCode: string;
  displayName: string;
  templateName: string;
  description: string;
  rateAmount: number;
  pricingLabel: string;
  hasDayPass?: boolean;
  dayPassPrice?: number | null;
  hasNightPass?: boolean;
  nightPassPrice?: number | null;
  hasWholeDayPass?: boolean;
  wholeDayPassPrice?: number | null;
  hasHalfDayPass?: boolean;
  halfDayPassPrice?: number | null;
  photoPath: string | null;
  photoPosition?: { x: number; y: number };
  capacity: number;
  tags?: string[];
  status: WorkspaceStatus;
  statusLabel: string;
  statusGlyph: string;
  statusTone: "success" | "warning" | "muted";
  x: number;
  y: number;
  width: number;
  height: number;
  shape: string;
}
