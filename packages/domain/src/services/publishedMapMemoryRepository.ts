import type { Floor } from '../models/workspace';
import type { PublishedFloorMap, PublishedMapAudience, PublishedMapRepository } from '../models/publishedMap';

export class InMemoryPublishedMapRepository implements PublishedMapRepository {
  private floors = new Map<string, Floor>();
  private publishedMaps = new Map<string, PublishedFloorMap>();

  seedFloor(floor: Floor) {
    this.floors.set(floor.id, { ...floor });
  }

  seedPublishedFloorMap(map: PublishedFloorMap) {
    this.seedFloor(map.floor);
    this.publishedMaps.set(map.floor.id, clonePublishedFloorMap(map));
  }

  async listPublishedFloors(): Promise<Floor[]> {
    return [...this.publishedMaps.values()]
      .map((map) => ({ ...this.floors.get(map.floor.id)! }))
      .filter((floor) => floor.isActive)
      .sort((left, right) => left.displayOrder - right.displayOrder || left.name.localeCompare(right.name));
  }

  async loadPublishedFloorMap(
    floorId: string,
    options?: { audience?: PublishedMapAudience }
  ): Promise<PublishedFloorMap | null> {
    const floor = this.floors.get(floorId);
    if (!floor || !floor.isActive) {
      return null;
    }

    const map = this.publishedMaps.get(floorId);
    if (!map) return null;

    const cloned = clonePublishedFloorMap(map);
    if (options?.audience === 'CUSTOMER' || options?.audience === 'KIOSK') {
      cloned.elements = cloned.elements.filter(
        (el) => el.elementRole !== 'WORKSPACE' || el.workspace?.operationalStatus !== 'INACTIVE'
      );
    }
    return cloned;
  }
}

function clonePublishedFloorMap(map: PublishedFloorMap): PublishedFloorMap {
  return {
    floor: { ...map.floor },
    version: { ...map.version },
    elements: map.elements.map((element) => ({
      ...element,
      style: { ...element.style },
      workspace: element.workspace ? { ...element.workspace } : null,
    })),
  };
}
