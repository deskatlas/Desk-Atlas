import type {
  AvailabilityRepository,
  BlockingReservationWindow,
  BusinessAvailabilitySettings,
  OperatingHoursInterval,
  ScheduleBlock,
} from '../models/availability';
import type {
  Floor,
  WorkspaceInstanceDetails,
  WorkspaceOperationalStatus,
  WorkspaceTemplate,
} from '../models/workspace';

export class InMemoryAvailabilityRepository implements AvailabilityRepository {
  private settings: BusinessAvailabilitySettings = {
    timezone: 'Asia/Manila',
    bookingIntervalMinutes: 30,
  };

  private instances = new Map<string, WorkspaceInstanceDetails>();
  private operatingHours = new Map<number, OperatingHoursInterval[]>();
  private scheduleBlocks: ScheduleBlock[] = [];
  private reservations: Array<BlockingReservationWindow & { workspaceInstanceId: string }> = [];

  setBusinessSettings(settings: Partial<BusinessAvailabilitySettings>) {
    this.settings = { ...this.settings, ...settings };
  }

  seedWorkspaceInstance(instance: Partial<WorkspaceInstanceDetails> & { id: string }) {
    const floor: Floor = instance.floor ?? {
      id: instance.floorId ?? 'floor-default',
      name: 'Main Floor',
      floorNumber: 1,
      displayOrder: 1,
      isActive: true,
    };
    const template: WorkspaceTemplate = instance.template ?? {
      id: instance.templateId ?? 'template-default',
      name: 'Hot Desk',
      description: 'Shared desk',
      photoPath: null,
      capacity: 1,
      rateAmount: 125,
      pricingUnit: 'HOURLY',
      defaultShape: 'desk',
      defaultColor: '#009689',
      defaultStyle: {},
      isActive: true,
    };

    this.instances.set(instance.id, {
      id: instance.id,
      templateId: instance.templateId ?? template.id,
      floorId: instance.floorId ?? floor.id,
      instanceCode: instance.instanceCode ?? instance.id.toUpperCase(),
      displayName: instance.displayName ?? instance.instanceCode ?? instance.id,
      operationalStatus: instance.operationalStatus ?? ('ACTIVE' as WorkspaceOperationalStatus),
      template,
      floor,
    });
  }

  seedOperatingHours(dayOfWeek: number, intervals: Array<Pick<OperatingHoursInterval, 'opensAt' | 'closesAt'>>) {
    this.operatingHours.set(
      dayOfWeek,
      intervals.map((interval, index) => ({
        id: `${dayOfWeek}-${index}`,
        dayOfWeek,
        opensAt: interval.opensAt,
        closesAt: interval.closesAt,
        isActive: true,
      }))
    );
  }

  seedScheduleBlock(block: ScheduleBlock) {
    this.scheduleBlocks.push({ ...block });
  }

  seedBlockingReservation(
    workspaceInstanceId: string,
    reservation: BlockingReservationWindow
  ) {
    this.reservations.push({ workspaceInstanceId, ...reservation });
  }

  async getWorkspaceInstance(instanceId: string): Promise<WorkspaceInstanceDetails | null> {
    const instance = this.instances.get(instanceId);
    return instance ? cloneInstance(instance) : null;
  }

  async listWorkspaceInstancesByTemplate(templateId: string): Promise<WorkspaceInstanceDetails[]> {
    return Array.from(this.instances.values())
      .filter((inst) => inst.templateId === templateId && inst.operationalStatus !== 'INACTIVE')
      .map(cloneInstance);
  }

  async getBusinessSettings(): Promise<BusinessAvailabilitySettings> {
    return { ...this.settings };
  }

  async listOperatingHours(dayOfWeek: number): Promise<OperatingHoursInterval[]> {
    return (this.operatingHours.get(dayOfWeek) ?? []).map((interval) => ({ ...interval }));
  }

  async listScheduleBlocks(
    workspaceInstanceId: string,
    rangeStartIso: string,
    rangeEndIso: string
  ): Promise<ScheduleBlock[]> {
    return this.scheduleBlocks
      .filter((block) => {
        const appliesToWorkspace =
          block.scope === 'BUSINESS' || block.workspaceInstanceId === workspaceInstanceId;
        return appliesToWorkspace && overlaps(block.startAt, block.endAt, rangeStartIso, rangeEndIso);
      })
      .map((block) => ({ ...block }));
  }

  async listBlockingReservations(
    workspaceInstanceId: string,
    rangeStartIso: string,
    rangeEndIso: string
  ): Promise<BlockingReservationWindow[]> {
    const nonBlockingStatuses = new Set(['CANCELLED', 'EXPIRED', 'REJECTED']);
    return this.reservations
      .filter((reservation) => {
        if (nonBlockingStatuses.has(reservation.reservationStatus)) return false;
        return (
          reservation.workspaceInstanceId === workspaceInstanceId &&
          overlaps(reservation.startAt, reservation.endAt, rangeStartIso, rangeEndIso)
        );
      })
      .map(({ workspaceInstanceId: _workspaceInstanceId, ...reservation }) => ({ ...reservation }));
  }

  async listOccupiedInstanceDetails(
    rangeStartIso: string,
    rangeEndIso: string
  ): Promise<Array<{ workspaceInstanceId: string; bookingEndAt: string | null }>> {
    const detailsMap = new Map<string, string | null>();
    const blockingStatuses = new Set([
      'CONFIRMED',
      'CHECKED_IN',
      'PENDING_PAYMENT',
      'PAYMENT_UNDER_REVIEW',
      'PENDING_COUNTER_CONFIRMATION',
    ]);
    for (const res of this.reservations) {
      if (
        blockingStatuses.has(res.reservationStatus) &&
        overlaps(res.startAt, res.endAt, rangeStartIso, rangeEndIso)
      ) {
        const existingEnd = detailsMap.get(res.workspaceInstanceId);
        if (!existingEnd || new Date(res.endAt).getTime() > new Date(existingEnd).getTime()) {
          detailsMap.set(res.workspaceInstanceId, res.endAt);
        }
      }
    }
    for (const block of this.scheduleBlocks) {
      if (overlaps(block.startAt, block.endAt, rangeStartIso, rangeEndIso)) {
        if (block.scope === 'BUSINESS') {
          for (const inst of this.instances.values()) {
            if (!detailsMap.has(inst.id)) {
              detailsMap.set(inst.id, block.endAt);
            }
          }
        } else if (block.workspaceInstanceId) {
          if (!detailsMap.has(block.workspaceInstanceId)) {
            detailsMap.set(block.workspaceInstanceId, block.endAt);
          }
        }
      }
    }
    return Array.from(detailsMap.entries()).map(([workspaceInstanceId, bookingEndAt]) => ({
      workspaceInstanceId,
      bookingEndAt,
    }));
  }

  async listOccupiedInstances(
    rangeStartIso: string,
    rangeEndIso: string
  ): Promise<string[]> {
    const details = await this.listOccupiedInstanceDetails(rangeStartIso, rangeEndIso);
    return details.map((d) => d.workspaceInstanceId);
  }
}

function overlaps(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string) {
  return new Date(leftStart).getTime() < new Date(rightEnd).getTime() &&
    new Date(leftEnd).getTime() > new Date(rightStart).getTime();
}

function cloneInstance(instance: WorkspaceInstanceDetails): WorkspaceInstanceDetails {
  return {
    ...instance,
    template: { ...instance.template, defaultStyle: { ...instance.template.defaultStyle } },
    floor: { ...instance.floor },
  };
}
