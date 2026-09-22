import type { Floor } from '../models/workspace';
import type {
  CreateCustomStructureTemplateInput,
  CustomStructureTemplate,
  FloorMap,
  MapElement,
  MapElementInput,
  MapPublishResult,
  MapRepository,
  MapVersion,
  PublishMapDraftInput,
  SaveMapDraftInput,
  UpdateCustomStructureTemplateInput,
  WorkspaceInstancePlacement,
} from '../models/map';

export class InMemoryMapRepository implements MapRepository {
  private floors = new Map<string, Floor>();
  private workspaceInstances = new Map<string, WorkspaceInstancePlacement>();
  private versions = new Map<string, MapVersion>();
  private elements = new Map<string, MapElement[]>();
  private customStructureTemplates = new Map<string, CustomStructureTemplate>();
  private sequence = 1;

  constructor(input?: {
    floors?: Floor[];
    workspaceInstances?: WorkspaceInstancePlacement[];
    customStructureTemplates?: CustomStructureTemplate[];
  }) {
    const defaultFloor: Floor = {
      id: 'floor-default',
      name: 'Main Floor',
      floorNumber: 1,
      displayOrder: 0,
      isActive: true,
    };

    for (const floor of input?.floors ?? [defaultFloor]) {
      this.floors.set(floor.id, floor);
    }

    for (const instance of input?.workspaceInstances ?? []) {
      this.workspaceInstances.set(instance.id, instance);
    }

    for (const template of input?.customStructureTemplates ?? []) {
      this.customStructureTemplates.set(template.id, { ...template });
    }
  }

  async getDefaultFloor(): Promise<Floor> {
    const floor = Array.from(this.floors.values())
      .filter((candidate) => candidate.isActive)
      .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name))[0];
    if (!floor) throw new Error('No active floor exists');
    return floor;
  }

  async getFloor(floorId: string): Promise<Floor | null> {
    return this.floors.get(floorId) ?? null;
  }

  async getWorkspaceInstance(instanceId: string): Promise<WorkspaceInstancePlacement | null> {
    return this.workspaceInstances.get(instanceId) ?? null;
  }

  async loadDraft(floorId: string): Promise<FloorMap | null> {
    return this.loadByStatus(floorId, 'DRAFT');
  }

  async loadPublished(floorId: string): Promise<FloorMap | null> {
    return this.loadByStatus(floorId, 'PUBLISHED');
  }

  async listVersions(floorId: string): Promise<MapVersion[]> {
    return Array.from(this.versions.values())
      .filter((version) => version.floorId === floorId)
      .sort((a, b) => a.versionNumber - b.versionNumber);
  }

  async saveDraft(
    input: Required<Omit<SaveMapDraftInput, 'actorUserId'>> & { actorUserId: string | null }
  ): Promise<FloorMap> {
    const floor = this.requireFloor(input.floorId);
    const existingDraft = await this.loadDraft(input.floorId);
    const version =
      existingDraft?.version ??
      ({
        id: this.nextId('map-version'),
        floorId: input.floorId,
        versionNumber: this.nextVersionNumber(input.floorId),
        status: 'DRAFT',
        canvasWidth: input.canvasWidth,
        canvasHeight: input.canvasHeight,
        gridSize: input.gridSize,
        createdByUserId: input.actorUserId,
        publishedByUserId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        publishedAt: null,
      } satisfies MapVersion);

    const updatedVersion: MapVersion = {
      ...version,
      canvasWidth: input.canvasWidth,
      canvasHeight: input.canvasHeight,
      gridSize: input.gridSize,
      updatedAt: new Date().toISOString(),
    };
    const updatedElements = input.elements.map((element, index) => this.createElement(updatedVersion.id, element, index));

    this.versions.set(updatedVersion.id, updatedVersion);
    this.elements.set(updatedVersion.id, updatedElements);

    return {
      floor,
      version: updatedVersion,
      elements: updatedElements,
    };
  }

  async publishDraft(input: PublishMapDraftInput): Promise<MapPublishResult> {
    const floor = this.requireFloor(input.floorId);
    const draft = await this.loadDraft(input.floorId);
    if (!draft) throw new Error(`No draft map exists for floor ${input.floorId}`);

    const archivedVersionIds: string[] = [];
    for (const version of this.versions.values()) {
      if (version.floorId === input.floorId && version.status === 'PUBLISHED') {
        const archived: MapVersion = {
          ...version,
          status: 'ARCHIVED',
          updatedAt: new Date().toISOString(),
        };
        this.versions.set(version.id, archived);
        archivedVersionIds.push(version.id);
      }
    }

    const publishedVersion: MapVersion = {
      ...draft.version,
      status: 'PUBLISHED',
      publishedByUserId: input.actorUserId ?? null,
      publishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const publishedElements = this.cloneElements(publishedVersion.id);
    const placedIds = new Set(
      publishedElements
        .map((e) => e.workspaceInstanceId)
        .filter((id): id is string => Boolean(id))
    );

    for (const [id, instance] of this.workspaceInstances.entries()) {
      if (instance.floorId === input.floorId && !placedIds.has(id)) {
        this.workspaceInstances.delete(id);
      }
    }

    return {
      published: {
        floor,
        version: publishedVersion,
        elements: publishedElements,
      },
      archivedVersionIds,
    };
  }

  private async loadByStatus(floorId: string, status: 'DRAFT' | 'PUBLISHED'): Promise<FloorMap | null> {
    const floor = this.floors.get(floorId);
    if (!floor) return null;

    const version = Array.from(this.versions.values()).find(
      (candidate) => candidate.floorId === floorId && candidate.status === status
    );
    if (!version) return null;

    return {
      floor,
      version: { ...version },
      elements: this.cloneElements(version.id),
    };
  }

  private createElement(mapVersionId: string, input: MapElementInput, index: number): MapElement {
    return {
      id: input.id ?? this.nextId('map-element'),
      mapVersionId,
      elementRole: input.elementRole,
      elementType: input.elementType,
      workspaceInstanceId: input.workspaceInstanceId ?? null,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      rotation: input.rotation ?? 0,
      zIndex: input.zIndex ?? index,
      label: input.label ?? null,
      properties: { ...(input.properties ?? {}) },
      isLocked: input.isLocked ?? false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async listCustomStructureTemplates(): Promise<CustomStructureTemplate[]> {
    return Array.from(this.customStructureTemplates.values())
      .filter((t) => t.isActive)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getCustomStructureTemplate(id: string): Promise<CustomStructureTemplate | null> {
    const template = this.customStructureTemplates.get(id);
    return template ? { ...template } : null;
  }

  async createCustomStructureTemplate(
    input: CreateCustomStructureTemplateInput
  ): Promise<CustomStructureTemplate> {
    const id = this.nextId('cstr-tmpl');
    const now = new Date().toISOString();
    const template: CustomStructureTemplate = {
      id,
      name: input.name,
      description: input.description ?? null,
      defaultWidth: input.defaultWidth ?? 120,
      defaultHeight: input.defaultHeight ?? 60,
      defaultColor: input.defaultColor ?? '#CBD5E1',
      borderStyle: input.borderStyle ?? 'solid',
      category: input.category ?? 'ARCHITECTURAL',
      isActive: input.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.customStructureTemplates.set(id, template);
    return { ...template };
  }

  async updateCustomStructureTemplate(
    id: string,
    input: UpdateCustomStructureTemplateInput
  ): Promise<CustomStructureTemplate> {
    const existing = this.customStructureTemplates.get(id);
    if (!existing) {
      throw new Error(`Custom structure template not found: ${id}`);
    }
    const updated: CustomStructureTemplate = {
      ...existing,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.defaultWidth !== undefined ? { defaultWidth: input.defaultWidth } : {}),
      ...(input.defaultHeight !== undefined ? { defaultHeight: input.defaultHeight } : {}),
      ...(input.defaultColor !== undefined ? { defaultColor: input.defaultColor } : {}),
      ...(input.borderStyle !== undefined ? { borderStyle: input.borderStyle } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.customStructureTemplates.set(id, updated);
    return { ...updated };
  }

  async deleteCustomStructureTemplate(id: string): Promise<void> {
    const existing = this.customStructureTemplates.get(id);
    if (!existing) {
      throw new Error(`Custom structure template not found: ${id}`);
    }
    this.customStructureTemplates.delete(id);
  }

  private cloneElements(mapVersionId: string): MapElement[] {
    return (this.elements.get(mapVersionId) ?? [])
      .map((element) => ({
        ...element,
        properties: { ...element.properties },
      }))
      .sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
  }

  private requireFloor(floorId: string): Floor {
    const floor = this.floors.get(floorId);
    if (!floor) throw new Error(`Floor not found: ${floorId}`);
    return floor;
  }

  private nextVersionNumber(floorId: string): number {
    return (
      Math.max(
        0,
        ...Array.from(this.versions.values())
          .filter((version) => version.floorId === floorId)
          .map((version) => version.versionNumber)
      ) + 1
    );
  }

  private nextId(prefix: string): string {
    return `${prefix}-${this.sequence++}`;
  }
}
