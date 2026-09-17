import type { PublishedFloorMap, PublishedMapElement } from "@deskatlas/domain";
import type { WorkspaceMapViewModel, WorkspaceStatus } from "../types";

export function mapPublishedFloorToWorkspaceCards(
  published: PublishedFloorMap
): WorkspaceMapViewModel[] {
  return published.elements
    .filter(
      (element) =>
        element.elementRole === "WORKSPACE" &&
        element.workspace &&
        element.workspace.operationalStatus !== "INACTIVE"
    )
    .map((element) => toWorkspaceCard(published.floor.name, element));
}

function toWorkspaceCard(
  floorName: string,
  element: PublishedMapElement
): WorkspaceMapViewModel {
  const workspace = element.workspace!;
  const status = toWorkspaceStatus(workspace.operationalStatus, workspace.isBookable);

  return {
    id: element.id,
    workspaceInstanceId: workspace.workspaceInstanceId,
    templateId: workspace.templateId,
    floorId: workspace.floorId,
    floorName,
    instanceCode: workspace.instanceCode,
    displayName: workspace.displayName,
    templateName: workspace.templateName,
    description: workspace.description ?? "Workspace details coming soon.",
    rateAmount: workspace.rateAmount,
    pricingLabel: `PHP ${workspace.rateAmount}/hour`,
    photoPath: workspace.photoPath,
    photoPosition: workspace.photoPosition,
    capacity: workspace.capacity,
    tags: workspace.tags,
    status,
    statusLabel: getStatusLabel(status),
    statusGlyph: getStatusGlyph(status),
    statusTone: getStatusTone(status),
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    shape: element.elementType,
  };
}

export function getWorkspacePhotoObjectPosition(photoPosition?: { x: number; y: number }): string {
  const x = typeof photoPosition?.x === "number" ? photoPosition.x : 50;
  const y = typeof photoPosition?.y === "number" ? photoPosition.y : 50;
  return `${x}% ${y}%`;
}

function toWorkspaceStatus(
  operationalStatus: string,
  isBookable: boolean
): WorkspaceStatus {
  if (!isBookable) {
    switch (operationalStatus) {
      case "MAINTENANCE":
        return "maintenance";
      case "BROKEN":
        return "broken";
      case "INACTIVE":
        return "inactive";
      default:
        return "unavailable";
    }
  }

  return "available";
}

function getStatusLabel(status: WorkspaceStatus) {
  switch (status) {
    case "available":
      return "Available";
    case "maintenance":
      return "Maintenance";
    case "broken":
      return "Broken";
    case "inactive":
      return "Inactive";
    default:
      return "Unavailable";
  }
}

function getStatusGlyph(status: WorkspaceStatus) {
  switch (status) {
    case "available":
      return "✓";
    case "maintenance":
      return "!";
    case "broken":
      return "!";
    case "inactive":
      return "–";
    default:
      return "×";
  }
}

function getStatusTone(status: WorkspaceStatus) {
  switch (status) {
    case "available":
      return "success";
    case "maintenance":
    case "broken":
      return "warning";
    default:
      return "muted";
  }
}
