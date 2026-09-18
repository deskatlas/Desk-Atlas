import {
  DEFAULT_WORKSPACE_STATUS_COLORS,
  type AdminPaymentMethod,
  type BusinessSettings,
  type CreatePaymentMethodInput,
  type UpdateBusinessSettingsInput,
  type UpdatePaymentMethodInput,
} from '../models/settings';
import type { OperatingHoursInterval, ScheduleBlock } from '../models/availability';
import type { SettingsRepository } from './settingsRepository';
import { normalizeWorkspaceStatusColors } from './workspaceStatusColorService';

export class InMemorySettingsRepository implements SettingsRepository {
  private businessSettings: BusinessSettings = {
    id: 1,
    businessName: 'DeskAtlas Coworking',
    timezone: 'Asia/Manila',
    contactEmail: 'contact@deskatlas.com',
    contactPhone: '+63 917 123 4567',
    bookingIntervalMinutes: 30,
    paymentExpiryMinutes: 60,
    kioskTimeoutMinutes: 5,
    customerSessionTimeoutMinutes: 20,
    customerRescheduleCutoffHours: 12,
    landingPreviewPhotos: [],
    statusColors: { ...DEFAULT_WORKSPACE_STATUS_COLORS },
    updatedAt: new Date().toISOString(),
  };

  private operatingHours: OperatingHoursInterval[] = [
    { id: 'oh-1', dayOfWeek: 1, opensAt: '09:00:00', closesAt: '18:00:00', isActive: true },
    { id: 'oh-2', dayOfWeek: 2, opensAt: '09:00:00', closesAt: '18:00:00', isActive: true },
    { id: 'oh-3', dayOfWeek: 3, opensAt: '09:00:00', closesAt: '18:00:00', isActive: true },
    { id: 'oh-4', dayOfWeek: 4, opensAt: '09:00:00', closesAt: '18:00:00', isActive: true },
    { id: 'oh-5', dayOfWeek: 5, opensAt: '09:00:00', closesAt: '18:00:00', isActive: true },
  ];

  private paymentMethods: AdminPaymentMethod[] = [
    {
      id: 'pm-gcash',
      methodType: 'GCASH',
      displayName: 'GCash Online',
      accountName: 'DeskAtlas Corp',
      accountNumber: '09171234567',
      qrImagePath: '/gcash-qr.png',
      instructions: 'Upload proof of payment after transferring.',
      allowWeb: true,
      allowKiosk: false,
      isActive: true,
      displayOrder: 1,
    },
    {
      id: 'pm-bank',
      methodType: 'BANK',
      displayName: 'Bank Transfer (BDO)',
      accountName: 'DeskAtlas Coworking Inc.',
      accountNumber: '1234-5678-9012',
      qrImagePath: null,
      instructions: 'Transfer to BDO account and upload receipt screenshot.',
      allowWeb: true,
      allowKiosk: false,
      isActive: true,
      displayOrder: 2,
    },
    {
      id: 'pm-cash',
      methodType: 'CASH',
      displayName: 'Cash at Counter',
      accountName: null,
      accountNumber: null,
      qrImagePath: null,
      instructions: 'Pay at the front desk counter before occupying your spot.',
      allowWeb: false,
      allowKiosk: true,
      isActive: true,
      displayOrder: 3,
    },
  ];

  async getBusinessSettings(): Promise<BusinessSettings> {
    return {
      ...this.businessSettings,
      landingPreviewPhotos: this.businessSettings.landingPreviewPhotos
        ? [...this.businessSettings.landingPreviewPhotos]
        : [],
      statusColors: this.businessSettings.statusColors
        ? { ...this.businessSettings.statusColors }
        : { ...DEFAULT_WORKSPACE_STATUS_COLORS },
    };
  }

  async updateBusinessSettings(
    input: UpdateBusinessSettingsInput,
    _updatedByUserId?: string | null
  ): Promise<BusinessSettings> {
    this.businessSettings = {
      ...this.businessSettings,
      businessName: input.businessName,
      timezone: input.timezone,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      bookingIntervalMinutes: input.bookingIntervalMinutes,
      paymentExpiryMinutes: input.paymentExpiryMinutes,
      kioskTimeoutMinutes: input.kioskTimeoutMinutes ?? null,
      customerSessionTimeoutMinutes: input.customerSessionTimeoutMinutes ?? 20,
      customerRescheduleCutoffHours: input.customerRescheduleCutoffHours ?? 12,
      landingPreviewPhotos:
        input.landingPreviewPhotos !== undefined
          ? [...input.landingPreviewPhotos]
          : this.businessSettings.landingPreviewPhotos,
      statusColors:
        input.statusColors !== undefined
          ? normalizeWorkspaceStatusColors(input.statusColors)
          : (this.businessSettings.statusColors || { ...DEFAULT_WORKSPACE_STATUS_COLORS }),
      updatedAt: new Date().toISOString(),
    };
    return {
      ...this.businessSettings,
      landingPreviewPhotos: this.businessSettings.landingPreviewPhotos
        ? [...this.businessSettings.landingPreviewPhotos]
        : [],
      statusColors: this.businessSettings.statusColors
        ? { ...this.businessSettings.statusColors }
        : { ...DEFAULT_WORKSPACE_STATUS_COLORS },
    };
  }

  async listOperatingHours(): Promise<OperatingHoursInterval[]> {
    return this.operatingHours.map((h) => ({ ...h }));
  }

  async replaceOperatingHours(
    intervals: Array<{
      dayOfWeek: number;
      opensAt: string;
      closesAt: string;
      isActive?: boolean;
    }>
  ): Promise<OperatingHoursInterval[]> {
    this.operatingHours = intervals.map((i, index) => ({
      id: `oh-gen-${index}`,
      dayOfWeek: i.dayOfWeek,
      opensAt: i.opensAt,
      closesAt: i.closesAt,
      isActive: i.isActive !== undefined ? i.isActive : true,
    }));
    return this.operatingHours.map((h) => ({ ...h }));
  }

  async listPaymentMethods(): Promise<AdminPaymentMethod[]> {
    return this.paymentMethods
      .map((p) => ({ ...p }))
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }

  async createPaymentMethod(input: CreatePaymentMethodInput): Promise<AdminPaymentMethod> {
    const maxOrder = this.paymentMethods.reduce((max, p) => Math.max(max, p.displayOrder), 0);
    const newMethod: AdminPaymentMethod = {
      id: `pm-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      methodType: input.methodType,
      displayName: input.displayName,
      accountName: input.accountName ?? null,
      accountNumber: input.accountNumber ?? null,
      qrImagePath: input.qrImagePath ?? null,
      instructions: input.instructions ?? null,
      allowWeb: input.allowWeb,
      allowKiosk: input.allowKiosk,
      isActive: input.isActive !== undefined ? input.isActive : true,
      displayOrder: input.displayOrder !== undefined ? input.displayOrder : maxOrder + 1,
    };
    this.paymentMethods.push(newMethod);
    return { ...newMethod };
  }

  async updatePaymentMethod(input: UpdatePaymentMethodInput): Promise<AdminPaymentMethod> {
    const idx = this.paymentMethods.findIndex((p) => p.id === input.id);
    if (idx === -1) {
      throw new Error(`Payment method with ID ${input.id} not found`);
    }

    const existing = this.paymentMethods[idx];
    const updated: AdminPaymentMethod = {
      ...existing,
      methodType: input.methodType ?? existing.methodType,
      displayName: input.displayName,
      accountName: input.accountName ?? existing.accountName,
      accountNumber: input.accountNumber ?? existing.accountNumber,
      qrImagePath: input.qrImagePath ?? existing.qrImagePath,
      instructions: input.instructions ?? existing.instructions,
      allowWeb: input.allowWeb,
      allowKiosk: input.allowKiosk,
      isActive: input.isActive,
      displayOrder: input.displayOrder ?? existing.displayOrder,
    };

    this.paymentMethods[idx] = updated;
    return { ...updated };
  }

  async deletePaymentMethod(id: string): Promise<void> {
    this.paymentMethods = this.paymentMethods.filter((p) => p.id !== id);
  }

  async reorderPaymentMethods(orderedIds: string[]): Promise<AdminPaymentMethod[]> {
    orderedIds.forEach((id, index) => {
      const found = this.paymentMethods.find((p) => p.id === id);
      if (found) {
        found.displayOrder = index + 1;
      }
    });
    let nextOrder = orderedIds.length + 1;
    this.paymentMethods.forEach((p) => {
      if (!orderedIds.includes(p.id)) {
        p.displayOrder = nextOrder++;
      }
    });
    return this.listPaymentMethods();
  }

  private scheduleBlocks: ScheduleBlock[] = [];

  async listBusinessScheduleBlocks(): Promise<ScheduleBlock[]> {
    return this.scheduleBlocks
      .filter((b) => b.scope === 'BUSINESS')
      .map((b) => ({ ...b }));
  }

  async createScheduleBlock(block: {
    scope: 'BUSINESS' | 'WORKSPACE';
    workspaceInstanceId?: string | null;
    blockType: string;
    startAt: string;
    endAt: string;
    reason?: string | null;
    createdByUserId?: string | null;
  }): Promise<ScheduleBlock> {
    const newBlock: ScheduleBlock = {
      id: `block-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      scope: block.scope,
      workspaceInstanceId: block.workspaceInstanceId ?? null,
      blockType: block.blockType,
      startAt: block.startAt,
      endAt: block.endAt,
      reason: block.reason ?? null,
    };
    this.scheduleBlocks.push(newBlock);
    return { ...newBlock };
  }

  async deleteScheduleBlocks(ids: string[]): Promise<void> {
    const idSet = new Set(ids);
    this.scheduleBlocks = this.scheduleBlocks.filter((b) => !idSet.has(b.id));
  }

  async deleteBusinessScheduleBlocksForDateRange(startIso: string, endIso: string): Promise<void> {
    const startMs = new Date(startIso).getTime();
    const endMs = new Date(endIso).getTime();
    this.scheduleBlocks = this.scheduleBlocks.filter((b) => {
      if (b.scope !== 'BUSINESS') return true;
      const bStartMs = new Date(b.startAt).getTime();
      const bEndMs = new Date(b.endAt).getTime();
      const overlaps = bStartMs < endMs && bEndMs > startMs;
      return !overlaps;
    });
  }
}

