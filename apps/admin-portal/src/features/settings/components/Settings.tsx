"use client";

import React, { useState, useEffect, useRef } from 'react';
import {
  DEFAULT_WORKSPACE_STATUS_COLORS,
  normalizeWorkspaceStatusColors,
  isValidHexColor,
  getContrastColor,
  type BusinessOperatingHoursMode,
  type BusinessSettings,
  type OperatingHoursConfig,
  type AdminPaymentMethod,
  type BusinessClosureException,
  type BusinessClosureType,
  type ClosureImpactPreviewResult,
  type LandingPreviewPhoto,
  type WorkspaceStatusColors,
} from '@deskatlas/domain';
import { handleNumericKeyDown } from '@deskatlas/ui';
import { CancellationPolicyUploader } from './CancellationPolicyUploader';

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const TIMEZONES = [
  { value: 'Asia/Manila', label: 'Asia/Manila (UTC+08:00)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (UTC+08:00)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (UTC+09:00)' },
  { value: 'Asia/Hong_Kong', label: 'Asia/Hong_Kong (UTC+08:00)' },
  { value: 'Asia/Bangkok', label: 'Asia/Bangkok (UTC+07:00)' },
  { value: 'Europe/London', label: 'Europe/London (UTC+00:00 / UTC+01:00)' },
  { value: 'America/New_York', label: 'America/New_York (UTC-05:00 / UTC-04:00)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (UTC-08:00 / UTC-07:00)' },
  { value: 'UTC', label: 'UTC' },
];

export function sanitizeAccountNumber(val: string | null | undefined): string {
  if (!val) return '';
  return val.replace(/[^0-9-]/g, '');
}

export function validatePaymentMethodRequiredFields(method: {
  accountName?: string | null;
  accountNumber?: string | null;
  methodType?: string;
}): { isValid: boolean; error?: string } {
  if (method.methodType === 'CASH') {
    return { isValid: true };
  }
  if (!method.accountName || !method.accountName.trim()) {
    return { isValid: false, error: 'Account/Receiver name is required' };
  }
  if (!method.accountNumber || !method.accountNumber.trim()) {
    return { isValid: false, error: 'Account/Mobile number is required' };
  }
  return { isValid: true };
}

export function isValidEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const trimmed = email.trim();
  if (!trimmed) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(trimmed);
}

export function validateContactEmail(email: string | null | undefined): { isValid: boolean; error?: string } {
  if (!email || !email.trim()) {
    return { isValid: false, error: 'Contact email is required.' };
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return { isValid: false, error: 'Please enter a valid contact email address.' };
  }
  return { isValid: true };
}

export function isValidUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  const trimmed = url.trim();
  if (!trimmed) return true;
  return /^https?:\/\//i.test(trimmed);
}

export function canSaveBusinessProfile(params: {
  businessName?: string | null;
  contactEmail?: string | null;
  phoneDigits?: string | null;
  contactPhone?: string | null;
  facebookUrl?: string | null;
  instagramUrl?: string | null;
  twitterUrl?: string | null;
  websiteUrl?: string | null;
  bookingIntervalMinutes?: number | string | null;
  kioskAllowanceMinutes?: number | string | null;
  bookingEndAlertMinutes?: number | string | null;
  rescheduleMaxAdvanceValue?: number | string | null;
  rescheduleMaxAdvanceUnit?: string | null;
  maxAdvanceBookingDays?: number | string | null;
}): { canSave: boolean; reason?: string } {
  if (!params.businessName || !params.businessName.trim()) {
    return { canSave: false, reason: 'Business name is required' };
  }

  const hasEmail = Boolean(params.contactEmail && params.contactEmail.trim());
  const phone = params.phoneDigits !== undefined ? params.phoneDigits : params.contactPhone;
  const hasPhone = Boolean(phone && phone.trim());

  if (!hasEmail && !hasPhone) {
    return { canSave: false, reason: 'At least one contact method (email or contact number) is required' };
  }

  if (hasEmail && !isValidEmail(params.contactEmail)) {
    return { canSave: false, reason: 'Please enter a valid contact email address' };
  }

  if (hasPhone) {
    const rawDigits = phone!.replace(/\D/g, '');
    const cleanDigits = rawDigits.startsWith('63') && rawDigits.length > 10
      ? rawDigits.slice(2)
      : (rawDigits.startsWith('0') && rawDigits.length === 11 ? rawDigits.slice(1) : rawDigits);
    if (cleanDigits.length !== 10) {
      return { canSave: false, reason: 'Contact number must be exactly 10 digits (e.g., 9171234567)' };
    }
  }

  if (params.facebookUrl && !isValidUrl(params.facebookUrl)) {
    return { canSave: false, reason: 'Facebook URL must start with http:// or https://' };
  }

  if (params.instagramUrl && !isValidUrl(params.instagramUrl)) {
    return { canSave: false, reason: 'Instagram URL must start with http:// or https://' };
  }

  if (params.twitterUrl && !isValidUrl(params.twitterUrl)) {
    return { canSave: false, reason: 'Twitter/X URL must start with http:// or https://' };
  }

  if (params.websiteUrl && !isValidUrl(params.websiteUrl)) {
    return { canSave: false, reason: 'Website URL must start with http:// or https://' };
  }

  if (params.bookingIntervalMinutes !== undefined && params.bookingIntervalMinutes !== null) {
    const intervalNum = Number(params.bookingIntervalMinutes);
    if (isNaN(intervalNum) || intervalNum < 1) {
      return { canSave: false, reason: 'Booking slot interval must be a positive integer in minutes' };
    }
  }

  if (params.kioskAllowanceMinutes !== undefined && params.kioskAllowanceMinutes !== null) {
    const allowanceNum = Number(params.kioskAllowanceMinutes);
    if (isNaN(allowanceNum) || allowanceNum < 0 || allowanceNum > 60) {
      return { canSave: false, reason: 'Kiosk booking allowance must be between 0 and 60 minutes' };
    }
  }

  if (params.bookingEndAlertMinutes !== undefined && params.bookingEndAlertMinutes !== null && params.bookingEndAlertMinutes !== '' as any) {
    const alertNum = Number(params.bookingEndAlertMinutes);
    if (isNaN(alertNum) || alertNum < 1 || alertNum > 60) {
      return { canSave: false, reason: 'Booking end-time alert threshold must be between 1 and 60 minutes' };
    }
  }

  if (params.rescheduleMaxAdvanceValue !== undefined && params.rescheduleMaxAdvanceValue !== null && params.rescheduleMaxAdvanceValue !== '' as any) {
    const val = Number(params.rescheduleMaxAdvanceValue);
    const isHours = params.rescheduleMaxAdvanceUnit === 'HOURS';
    const maxBound = isHours ? 8760 : 365;
    if (isNaN(val) || val < 1 || val > maxBound) {
      return { canSave: false, reason: `Maximum reschedule advance limit must be between 1 and ${maxBound} ${isHours ? 'hours' : 'days'}` };
    }
  }

  if (params.maxAdvanceBookingDays !== undefined && params.maxAdvanceBookingDays !== null && (params.maxAdvanceBookingDays as unknown) !== '') {
    const maxDays = Number(params.maxAdvanceBookingDays);
    if (isNaN(maxDays) || maxDays < 1 || maxDays > 365) {
      return { canSave: false, reason: 'Maximum advance booking window must be between 1 and 365 days' };
    }
  }

  return { canSave: true };
}

export function extractTenDigitPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('63') && digits.length > 10) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0') && digits.length === 11) {
    digits = digits.slice(1);
  }
  return digits.slice(0, 10);
}

export function getMinClosingTime(opensAt: string): string {
  if (!opensAt) return '00:01';
  const match = opensAt.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '00:01';
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const totalMinutes = hours * 60 + minutes + 1;
  if (totalMinutes >= 24 * 60) {
    return '23:59';
  }
  const nextHour = Math.floor(totalMinutes / 60);
  const nextMin = totalMinutes % 60;
  return `${String(nextHour).padStart(2, '0')}:${String(nextMin).padStart(2, '0')}`;
}

export function getDefaultClosingTime(opensAt: string, currentClosesAt?: string): string {
  if (!opensAt) return currentClosesAt || '18:00';
  if (currentClosesAt && currentClosesAt > opensAt) {
    return currentClosesAt;
  }
  const match = opensAt.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '18:00';
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const totalMinutes = hours * 60 + minutes + 60;
  if (totalMinutes >= 24 * 60) {
    return '24:00';
  }
  const nextHour = Math.floor(totalMinutes / 60);
  const nextMin = totalMinutes % 60;
  return `${String(nextHour).padStart(2, '0')}:${String(nextMin).padStart(2, '0')}`;
}

export function isClosingTimeValid(opensAt: string, closesAt: string): boolean {
  if (!opensAt || !closesAt) return false;
  return closesAt > opensAt;
}

export function getTimeOptions(include24 = false, extraValue?: string): string[] {
  const options: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      options.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  if (include24) {
    options.push('24:00');
  }
  if (extraValue && !options.includes(extraValue)) {
    options.push(extraValue);
    options.sort();
  }
  return options;
}

export function getTimeLabel(timeStr: string): string {
  if (!timeStr) return '';
  if (timeStr === '24:00') return '24:00 (12:00 AM Next Day)';
  if (timeStr === '00:00') return '00:00 (12:00 AM)';
  const [hStr, mStr] = timeStr.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr || '0', 10);
  if (isNaN(h)) return timeStr;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const formatted12 = `${hour12}:${String(m).padStart(2, '0')} ${period}`;
  return `${timeStr} (${formatted12})`;
}

export function getTodayDateString(timezone: string = 'Asia/Manila'): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().split('T')[0]!;
  }
}

export function isPastDate(dateStr: string, timezone: string = 'Asia/Manila'): boolean {
  if (!dateStr) return false;
  const todayStr = getTodayDateString(timezone);
  return dateStr < todayStr;
}

export function Settings() {
  const [activeTab, setActiveTab] = useState<
    'Business Profile' | 'Business Hours' | 'Payment Methods' | 'Closures & Holidays' | 'Landing Preview' | 'Kiosk Settings'
  >('Business Profile');
  const tabs: Array<'Business Profile' | 'Business Hours' | 'Payment Methods' | 'Closures & Holidays' | 'Landing Preview' | 'Kiosk Settings'> = [
    'Business Profile',
    'Business Hours',
    'Payment Methods',
    'Closures & Holidays',
    'Landing Preview',
    'Kiosk Settings',
  ];

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form States
  const [businessSettings, setBusinessSettings] = useState<BusinessSettings>({
    id: 1,
    businessName: 'DeskAtlas Manila',
    timezone: 'Asia/Manila',
    contactEmail: null,
    contactPhone: null,
    facebookUrl: null,
    instagramUrl: null,
    twitterUrl: null,
    websiteUrl: null,
    bookingIntervalMinutes: 30,
    paymentExpiryMinutes: 60,
    kioskTimeoutMinutes: 5,
    kioskAllowanceMinutes: 5,
    bookingEndAlertMinutes: 5,
    customerSessionTimeoutMinutes: 20,
    customerRescheduleCutoffHours: 12,
    rescheduleMaxAdvanceValue: 30,
    rescheduleMaxAdvanceUnit: 'DAYS',
    landingPreviewPhotos: [],
    statusColors: { ...DEFAULT_WORKSPACE_STATUS_COLORS },
  });

  const [statusColors, setStatusColors] = useState<WorkspaceStatusColors>({
    ...DEFAULT_WORKSPACE_STATUS_COLORS,
  });

  const [phoneDigits, setPhoneDigits] = useState<string>('');

  const [landingPreviewPhotos, setLandingPreviewPhotos] = useState<LandingPreviewPhoto[]>([]);
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);
  const [adjustingSlot, setAdjustingSlot] = useState<number | null>(null);
  const [isDraggingPhoto, setIsDraggingPhoto] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; posX: number; posY: number } | null>(null);

  const [hoursMode, setHoursMode] = useState<BusinessOperatingHoursMode>('CUSTOM_HOURS');
  const [daySchedules, setDaySchedules] = useState<
    Array<{
      dayOfWeek: number;
      isOpen: boolean;
      is24Hours: boolean;
      opensAt: string;
      closesAt: string;
    }>
  >(
    DAY_NAMES.map((_, index) => ({
      dayOfWeek: index,
      isOpen: index >= 1 && index <= 5, // Mon-Fri default
      is24Hours: false,
      opensAt: '09:00',
      closesAt: '18:00',
    }))
  );

  const [paymentMethods, setPaymentMethods] = useState<AdminPaymentMethod[]>([]);
  const [isAddPaymentModalOpen, setIsAddPaymentModalOpen] = useState(false);
  const [missingContactModal, setMissingContactModal] = useState<{
    isOpen: boolean;
    missingType: 'email' | 'phone' | null;
  }>({ isOpen: false, missingType: null });
  const [uploadingQrId, setUploadingQrId] = useState<string | null>(null);
  const [viewingQrUrl, setViewingQrUrl] = useState<string | null>(null);
  const [addPaymentForm, setAddPaymentForm] = useState<{
    methodType: 'GCASH' | 'BANK';
    providerPreset: string;
    displayName: string;
    accountName: string;
    accountNumber: string;
    instructions: string;
    qrImagePath: string | null;
    allowWeb: boolean;
    allowKiosk: boolean;
    isActive: boolean;
  }>({
    methodType: 'GCASH',
    providerPreset: 'GCASH',
    displayName: 'GCash',
    accountName: '',
    accountNumber: '',
    instructions: 'Scan QR code or transfer to mobile number, then upload the payment confirmation screenshot.',
    qrImagePath: null,
    allowWeb: true,
    allowKiosk: true,
    isActive: true,
  });

  const [closures, setClosures] = useState<BusinessClosureException[]>([]);
  const [closuresLoading, setClosuresLoading] = useState(false);

  // Closures Calendar & Form State
  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayDateString('Asia/Manila'));
  const [isMultiDay, setIsMultiDay] = useState(false);
  const [closureEndDate, setClosureEndDate] = useState<string>('');
  const [closureType, setClosureType] = useState<BusinessClosureType>('FULL_DAY');
  const [specialOpensAt, setSpecialOpensAt] = useState('10:00');
  const [specialClosesAt, setSpecialClosesAt] = useState('14:00');
  const [closureReason, setClosureReason] = useState('');
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => new Date());
  const [impactPreview, setImpactPreview] = useState<ClosureImpactPreviewResult | null>(null);
  const [showImpactModal, setShowImpactModal] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    fetchSettings();
    fetchClosures();
  }, []);

  async function fetchSettings() {
    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await fetch('/api/admin/settings');
      if (!res.ok) {
        throw new Error(`Failed to load settings (status: ${res.status})`);
      }
      const json = await res.json();
      const overview = json.data;

      if (overview?.businessSettings) {
        setBusinessSettings(overview.businessSettings);
        setPhoneDigits(extractTenDigitPhone(overview.businessSettings.contactPhone));
        if (overview.businessSettings.statusColors) {
          setStatusColors(normalizeWorkspaceStatusColors(overview.businessSettings.statusColors));
        }
        if (Array.isArray(overview.businessSettings.landingPreviewPhotos)) {
          setLandingPreviewPhotos(overview.businessSettings.landingPreviewPhotos);
        }
      }

      if (overview?.operatingHoursConfig) {
        const config: OperatingHoursConfig = overview.operatingHoursConfig;
        setHoursMode(config.mode);

        const merged = DAY_NAMES.map((_, index) => {
          const found = config.schedules.find((s) => s.dayOfWeek === index);
          if (found) {
            const firstInterval = found.intervals[0];
            return {
              dayOfWeek: index,
              isOpen: found.isOpen,
              is24Hours: found.is24Hours,
              opensAt: firstInterval?.opensAt ?? '09:00',
              closesAt: firstInterval?.closesAt ?? '18:00',
            };
          }
          return {
            dayOfWeek: index,
            isOpen: false,
            is24Hours: false,
            opensAt: '09:00',
            closesAt: '18:00',
          };
        });
        setDaySchedules(merged);
      }

      if (overview?.paymentMethods) {
        setPaymentMethods(overview.paymentMethods);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to fetch settings');
    } finally {
      setLoading(false);
    }
  }

  const handlePhotoMouseDown = (slotIndex: number, e: React.MouseEvent<HTMLDivElement>) => {
    if (adjustingSlot !== slotIndex) return;
    e.preventDefault();
    const photo = landingPreviewPhotos.find((p) => p.displayOrder === slotIndex) || landingPreviewPhotos[slotIndex];
    const posX = photo?.position?.x ?? 50;
    const posY = photo?.position?.y ?? 50;
    dragStartRef.current = { x: e.clientX, y: e.clientY, posX, posY };
    setIsDraggingPhoto(true);
  };

  const handlePhotoMouseMove = (slotIndex: number, e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingPhoto || !dragStartRef.current || adjustingSlot !== slotIndex) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const deltaX = e.clientX - dragStartRef.current.x;
    const deltaY = e.clientY - dragStartRef.current.y;
    const newX = Math.max(0, Math.min(100, dragStartRef.current.posX - (deltaX / rect.width) * 100));
    const newY = Math.max(0, Math.min(100, dragStartRef.current.posY - (deltaY / rect.height) * 100));
    
    setLandingPreviewPhotos((prev) => {
      const updated = [...prev];
      const idx = updated.findIndex((p) => p.displayOrder === slotIndex);
      if (idx !== -1) {
        updated[idx] = {
          ...updated[idx],
          position: { x: Math.round(newX), y: Math.round(newY) },
        };
      } else if (slotIndex < updated.length) {
        updated[slotIndex] = {
          ...updated[slotIndex],
          position: { x: Math.round(newX), y: Math.round(newY) },
        };
      }
      return updated;
    });
  };

  const handlePhotoMouseUp = () => {
    setIsDraggingPhoto(false);
    dragStartRef.current = null;
  };

  const handlePhotoTouchStart = (slotIndex: number, e: React.TouchEvent<HTMLDivElement>) => {
    if (adjustingSlot !== slotIndex) return;
    const touch = e.touches[0];
    if (!touch) return;
    const photo = landingPreviewPhotos.find((p) => p.displayOrder === slotIndex) || landingPreviewPhotos[slotIndex];
    const posX = photo?.position?.x ?? 50;
    const posY = photo?.position?.y ?? 50;
    dragStartRef.current = { x: touch.clientX, y: touch.clientY, posX, posY };
    setIsDraggingPhoto(true);
  };

  const handlePhotoTouchMove = (slotIndex: number, e: React.TouchEvent<HTMLDivElement>) => {
    if (!isDraggingPhoto || !dragStartRef.current || adjustingSlot !== slotIndex) return;
    const touch = e.touches[0];
    if (!touch) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const deltaX = touch.clientX - dragStartRef.current.x;
    const deltaY = touch.clientY - dragStartRef.current.y;
    const newX = Math.max(0, Math.min(100, dragStartRef.current.posX - (deltaX / rect.width) * 100));
    const newY = Math.max(0, Math.min(100, dragStartRef.current.posY - (deltaY / rect.height) * 100));

    setLandingPreviewPhotos((prev) => {
      const updated = [...prev];
      const idx = updated.findIndex((p) => p.displayOrder === slotIndex);
      if (idx !== -1) {
        updated[idx] = {
          ...updated[idx],
          position: { x: Math.round(newX), y: Math.round(newY) },
        };
      } else if (slotIndex < updated.length) {
        updated[slotIndex] = {
          ...updated[slotIndex],
          position: { x: Math.round(newX), y: Math.round(newY) },
        };
      }
      return updated;
    });
  };

  const handlePhotoTouchEnd = () => {
    setIsDraggingPhoto(false);
    dragStartRef.current = null;
  };

  const handleUploadLandingPhoto = async (slotIndex: number, file: File) => {
    const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    const MAX_FILE_SIZE = 5 * 1024 * 1024;

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      setErrorMsg('Invalid file type. Allowed formats: PNG, JPG, JPEG, WebP');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setErrorMsg('File size exceeds 5MB limit');
      return;
    }

    try {
      setUploadingSlot(slotIndex);
      setErrorMsg(null);
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/admin/workspaces/upload-image', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to upload preview image');
      }

      const data = await res.json();
      const newPhoto: LandingPreviewPhoto = {
        id: `preview-${Date.now()}-${slotIndex}`,
        url: data.url,
        storagePath: data.path || null,
        position: { x: 50, y: 50 },
        displayOrder: slotIndex,
      };

      setLandingPreviewPhotos((prev) => {
        const currentSorted = [...prev].sort((a, b) => a.displayOrder - b.displayOrder);
        const existingIdx = currentSorted.findIndex((p) => p.displayOrder === slotIndex);
        if (existingIdx !== -1) {
          currentSorted[existingIdx] = newPhoto;
        } else {
          currentSorted.push(newPhoto);
        }
        return currentSorted.sort((a, b) => a.displayOrder - b.displayOrder).slice(0, 3);
      });

      setAdjustingSlot(slotIndex);
      showSuccess(`Photo uploaded to Slot ${slotIndex + 1}! Drag to reposition and click Done.`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to upload preview photo');
    } finally {
      setUploadingSlot(null);
    }
  };

  const handleRemoveLandingPhoto = (slotIndex: number) => {
    setLandingPreviewPhotos((prev) => {
      const remaining = prev
        .filter((p) => p.displayOrder !== slotIndex)
        .map((p, idx) => ({ ...p, displayOrder: idx }));
      return remaining;
    });
    if (adjustingSlot === slotIndex) {
      setAdjustingSlot(null);
    }
    showSuccess(`Slot ${slotIndex + 1} photo removed`);
  };

  const handleSaveLandingPreview = async () => {
    try {
      setSaving(true);
      setErrorMsg(null);
      const sortedPhotos = [...landingPreviewPhotos]
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((p, idx) => ({ ...p, displayOrder: idx }));

      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...businessSettings,
          landingPreviewPhotos: sortedPhotos,
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Failed to save landing preview photos');
      }

      const json = await res.json();
      setBusinessSettings(json.data);
      if (json.data.landingPreviewPhotos) {
        setLandingPreviewPhotos(json.data.landingPreviewPhotos);
      }
      setAdjustingSlot(null);
      showSuccess('Landing preview photos saved successfully!');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save landing preview photos');
    } finally {
      setSaving(false);
    }
  };

  async function fetchClosures() {
    try {
      setClosuresLoading(true);
      const res = await fetch('/api/admin/settings/closures');
      if (!res.ok) {
        throw new Error(`Failed to load closures (status: ${res.status})`);
      }
      const json = await res.json();
      if (Array.isArray(json.data)) {
        setClosures(json.data);
      }
    } catch (err: any) {
      console.error('Failed to fetch closures:', err);
    } finally {
      setClosuresLoading(false);
    }
  }

  function showSuccess(msg: string) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  }

  async function handleSaveClosure(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!selectedDate) {
      setErrorMsg('Please select a date.');
      return;
    }

    const todayStr = getTodayDateString(businessSettings.timezone);
    if (selectedDate < todayStr) {
      setErrorMsg('Closures and holidays cannot be set for past dates.');
      return;
    }

    if (isMultiDay && closureEndDate && closureEndDate < todayStr) {
      setErrorMsg('Closure end date cannot be in the past.');
      return;
    }

    if (isMultiDay && closureEndDate && closureEndDate < selectedDate) {
      setErrorMsg('Closure end date must be on or after the start date.');
      return;
    }

    if (closureType === 'SPECIAL_HOURS') {
      if (!specialOpensAt || !specialClosesAt) {
        setErrorMsg('Please specify both opening and closing times for special hours.');
        return;
      }
      if (specialOpensAt >= specialClosesAt) {
        setErrorMsg(`Closing time (${specialClosesAt}) must be strictly after opening time (${specialOpensAt}).`);
        return;
      }
    }

    try {
      setPreviewLoading(true);
      setErrorMsg(null);

      const previewRes = await fetch('/api/admin/settings/closures/preview-impact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: selectedDate,
          endDate: isMultiDay && closureEndDate ? closureEndDate : null,
          closureType,
          opensAt: closureType === 'SPECIAL_HOURS' ? specialOpensAt : null,
          closesAt: closureType === 'SPECIAL_HOURS' ? specialClosesAt : null,
          reason: closureReason || null,
        }),
      });

      if (previewRes.ok) {
        const previewJson = await previewRes.json();
        const previewData: ClosureImpactPreviewResult = previewJson.data;
        if (previewData && previewData.impactedCount > 0) {
          setImpactPreview(previewData);
          setShowImpactModal(true);
          return;
        }
      }

      await executeSaveClosure();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to evaluate closure impact');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function executeSaveClosure() {
    try {
      setSaving(true);
      setErrorMsg(null);

      const res = await fetch('/api/admin/settings/closures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: selectedDate,
          endDate: isMultiDay && closureEndDate ? closureEndDate : null,
          closureType,
          opensAt: closureType === 'SPECIAL_HOURS' ? specialOpensAt : null,
          closesAt: closureType === 'SPECIAL_HOURS' ? specialClosesAt : null,
          reason: closureReason || null,
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Failed to save closure exception');
      }

      setShowImpactModal(false);
      setImpactPreview(null);
      await fetchClosures();
      setClosureReason('');
      showSuccess(`Closure / exception for ${selectedDate} saved!`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save closure exception');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteClosure(exception: BusinessClosureException) {
    if (!confirm(`Are you sure you want to remove the closure for ${exception.date}${exception.endDate ? ` to ${exception.endDate}` : ''}?`)) {
      return;
    }
    try {
      setSaving(true);
      setErrorMsg(null);

      const res = await fetch('/api/admin/settings/closures', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockIds: exception.blockIds }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Failed to delete closure');
      }

      await fetchClosures();
      showSuccess(`Closure for ${exception.date} removed!`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to delete closure');
    } finally {
      setSaving(false);
    }
  }


  function handlePhoneChange(val: string) {
    let digits = val.replace(/\D/g, '');
    if (digits.startsWith('63') && digits.length > 10) {
      digits = digits.slice(2);
    } else if (digits.startsWith('0') && digits.length === 11) {
      digits = digits.slice(1);
    }
    const clean = digits.slice(0, 10);
    setPhoneDigits(clean);
    setBusinessSettings((prev) => ({
      ...prev,
      contactPhone: clean ? `+63${clean}` : null,
    }));
  }

  // Handle Business Profile / Kiosk Save
  function handleSaveProfile(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setErrorMsg(null);

    const check = canSaveBusinessProfile({
      businessName: businessSettings.businessName,
      contactEmail: businessSettings.contactEmail,
      phoneDigits,
      facebookUrl: businessSettings.facebookUrl,
      instagramUrl: businessSettings.instagramUrl,
      twitterUrl: businessSettings.twitterUrl,
      websiteUrl: businessSettings.websiteUrl,
      bookingIntervalMinutes: businessSettings.bookingIntervalMinutes,
      bookingEndAlertMinutes: businessSettings.bookingEndAlertMinutes,
      maxAdvanceBookingDays: businessSettings.maxAdvanceBookingDays,
    });

    if (!check.canSave) {
      setErrorMsg(check.reason || 'Please fill in all required fields.');
      return;
    }

    const hasEmail = Boolean(businessSettings.contactEmail && businessSettings.contactEmail.trim());
    const hasPhone = Boolean(phoneDigits && phoneDigits.trim());

    if (hasEmail && !hasPhone) {
      setMissingContactModal({ isOpen: true, missingType: 'phone' });
      return;
    }

    if (!hasEmail && hasPhone) {
      setMissingContactModal({ isOpen: true, missingType: 'email' });
      return;
    }

    executeSaveProfile();
  }

  async function executeSaveProfile() {
    try {
      setSaving(true);
      setErrorMsg(null);

      const normalizedExpiry = !businessSettings.paymentExpiryMinutes || Number(businessSettings.paymentExpiryMinutes) < 5
        ? 60
        : Number(businessSettings.paymentExpiryMinutes);
      const normalizedTimeout = !businessSettings.kioskTimeoutMinutes || Number(businessSettings.kioskTimeoutMinutes) < 1
        ? 5
        : Number(businessSettings.kioskTimeoutMinutes);
      const normalizedAllowance = businessSettings.kioskAllowanceMinutes === undefined || businessSettings.kioskAllowanceMinutes === null || Number(businessSettings.kioskAllowanceMinutes) < 0
        ? 5
        : Math.min(60, Math.max(0, Number(businessSettings.kioskAllowanceMinutes)));
      const normalizedEndAlert = businessSettings.bookingEndAlertMinutes === undefined || businessSettings.bookingEndAlertMinutes === null || Number(businessSettings.bookingEndAlertMinutes) < 1
        ? 5
        : Math.min(60, Math.max(1, Number(businessSettings.bookingEndAlertMinutes)));
      const normalizedSessionTimeout = !businessSettings.customerSessionTimeoutMinutes || Number(businessSettings.customerSessionTimeoutMinutes) < 1
        ? 20
        : Math.min(180, Math.max(1, Number(businessSettings.customerSessionTimeoutMinutes)));
      const normalizedRescheduleCutoff = businessSettings.customerRescheduleCutoffHours === undefined || businessSettings.customerRescheduleCutoffHours === null || Number(businessSettings.customerRescheduleCutoffHours) < 0
        ? 12
        : Math.min(720, Math.max(0, Number(businessSettings.customerRescheduleCutoffHours)));
      const normalizedMaxAdvanceUnit = businessSettings.rescheduleMaxAdvanceUnit === 'HOURS' ? 'HOURS' : 'DAYS';
      const maxBound = normalizedMaxAdvanceUnit === 'HOURS' ? 8760 : 365;
      const normalizedMaxAdvanceVal = !businessSettings.rescheduleMaxAdvanceValue || Number(businessSettings.rescheduleMaxAdvanceValue) < 1
        ? 30
        : Math.min(maxBound, Math.max(1, Number(businessSettings.rescheduleMaxAdvanceValue)));
      const normalizedMaxAdvanceBookingDays = businessSettings.maxAdvanceBookingDays === undefined || businessSettings.maxAdvanceBookingDays === null || Number(businessSettings.maxAdvanceBookingDays) < 1
        ? 90
        : Math.min(365, Math.max(1, Number(businessSettings.maxAdvanceBookingDays)));

      const payload = {
        ...businessSettings,
        facebookUrl: businessSettings.facebookUrl?.trim() || null,
        instagramUrl: businessSettings.instagramUrl?.trim() || null,
        twitterUrl: businessSettings.twitterUrl?.trim() || null,
        websiteUrl: businessSettings.websiteUrl?.trim() || null,
        statusColors: normalizeWorkspaceStatusColors(statusColors),
        contactEmail: businessSettings.contactEmail?.trim() || null,
        contactPhone: phoneDigits ? `+63${phoneDigits}` : null,
        paymentExpiryMinutes: normalizedExpiry,
        kioskTimeoutMinutes: normalizedTimeout,
        kioskAllowanceMinutes: normalizedAllowance,
        bookingEndAlertMinutes: normalizedEndAlert,
        customerSessionTimeoutMinutes: normalizedSessionTimeout,
        customerRescheduleCutoffHours: normalizedRescheduleCutoff,
        rescheduleMaxAdvanceValue: normalizedMaxAdvanceVal,
        rescheduleMaxAdvanceUnit: normalizedMaxAdvanceUnit,
        maxAdvanceBookingDays: normalizedMaxAdvanceBookingDays,
      };

      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Failed to save business settings');
      }

      const json = await res.json();
      setBusinessSettings(json.data);
      setPhoneDigits(extractTenDigitPhone(json.data.contactPhone));
      if (json.data.statusColors) {
        setStatusColors(normalizeWorkspaceStatusColors(json.data.statusColors));
      }
      setMissingContactModal({ isOpen: false, missingType: null });
      showSuccess('Business settings updated successfully!');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save business settings');
    } finally {
      setSaving(false);
    }
  }

  // Handle Business Hours Mode Switch
  function handleModeChange(mode: BusinessOperatingHoursMode) {
    setHoursMode(mode);
    if (mode === '24_7') {
      setDaySchedules((prev) =>
        prev.map((d) => ({
          ...d,
          isOpen: true,
          is24Hours: true,
          opensAt: '00:00',
          closesAt: '24:00',
        }))
      );
    } else if (mode === '24_HOURS_SELECTED_DAYS') {
      setDaySchedules((prev) =>
        prev.map((d) => ({
          ...d,
          is24Hours: d.isOpen,
          opensAt: '00:00',
          closesAt: '24:00',
        }))
      );
    }
  }

  // Apply one day's schedule to all other days
  function handleApplyHoursToAll(sourceDayIndex: number, onlyOpenDays = false) {
    const source = daySchedules[sourceDayIndex];
    if (!source) return;

    setDaySchedules((prev) =>
      prev.map((d, i) => {
        if (i === sourceDayIndex) return d;
        if (onlyOpenDays && !d.isOpen) return d;
        return {
          ...d,
          isOpen: onlyOpenDays ? d.isOpen : source.isOpen,
          is24Hours: source.is24Hours,
          opensAt: source.opensAt,
          closesAt: source.closesAt,
        };
      })
    );
    showSuccess(
      `Applied ${DAY_NAMES[source.dayOfWeek]} hours (${source.is24Hours ? '24 Hours' : `${source.opensAt} - ${source.closesAt}`}) to ${onlyOpenDays ? 'all open days' : 'all days'}!`
    );
  }

  // Save Operating Hours
  async function handleSaveOperatingHours() {
    try {
      setSaving(true);
      setErrorMsg(null);

      if (hoursMode === 'CUSTOM_HOURS') {
        for (const s of daySchedules) {
          if (s.isOpen && !s.is24Hours) {
            if (!s.opensAt || !s.closesAt) {
              setErrorMsg(`Please specify opening and closing times for ${DAY_NAMES[s.dayOfWeek]}.`);
              setSaving(false);
              return;
            }
            if (s.opensAt >= s.closesAt) {
              setErrorMsg(
                `${DAY_NAMES[s.dayOfWeek]} closing time (${s.closesAt}) must be strictly after opening time (${s.opensAt}).`
              );
              setSaving(false);
              return;
            }
          }
        }
      }

      const schedulesToSubmit = daySchedules.map((s) => {
        if (!s.isOpen) {
          return {
            dayOfWeek: s.dayOfWeek,
            isOpen: false,
            is24Hours: false,
            intervals: [],
          };
        }

        if (hoursMode === '24_7' || hoursMode === '24_HOURS_SELECTED_DAYS' || s.is24Hours) {
          return {
            dayOfWeek: s.dayOfWeek,
            isOpen: true,
            is24Hours: true,
            intervals: [{ opensAt: '00:00', closesAt: '24:00' }],
          };
        }

        return {
          dayOfWeek: s.dayOfWeek,
          isOpen: true,
          is24Hours: false,
          intervals: [{ opensAt: s.opensAt, closesAt: s.closesAt }],
        };
      });

      const res = await fetch('/api/admin/settings/operating-hours', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: hoursMode,
          schedules: schedulesToSubmit,
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Failed to save operating hours');
      }

      showSuccess('Business operating hours updated successfully!');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save operating hours');
    } finally {
      setSaving(false);
    }
  }

  const PROVIDER_PRESETS = [
    {
      id: 'GCASH',
      name: 'GCash',
      methodType: 'GCASH' as const,
      instructions: 'Transfer via GCash to mobile number or scan the QR code, then upload your proof screenshot.',
      badgeBg: '#E0F2FE',
      badgeColor: '#0284C7',
      badgeBorder: '#BAE6FD',
    },
    {
      id: 'MAYA',
      name: 'Maya',
      methodType: 'BANK' as const,
      instructions: 'Send to Maya account / Maya Bank or scan QR code, then upload transaction screenshot.',
      badgeBg: '#DCFCE7',
      badgeColor: '#15803D',
      badgeBorder: '#BBF7D0',
    },
    {
      id: 'MARIBANK',
      name: 'MariBank',
      methodType: 'BANK' as const,
      instructions: 'Transfer to MariBank account or scan QR code, then upload transfer confirmation screenshot.',
      badgeBg: '#FFEDD5',
      badgeColor: '#C2410C',
      badgeBorder: '#FED7AA',
    },
    {
      id: 'BDO',
      name: 'BDO Unibank',
      methodType: 'BANK' as const,
      instructions: 'Transfer to BDO account or scan QR code, then upload deposit slip or transfer screenshot.',
      badgeBg: '#EFF6FF',
      badgeColor: '#1D4ED8',
      badgeBorder: '#BFDBFE',
    },
    {
      id: 'BPI',
      name: 'Bank of the Philippine Islands (BPI)',
      methodType: 'BANK' as const,
      instructions: 'Transfer to BPI account or scan QR code, then upload transfer confirmation screenshot.',
      badgeBg: '#FEE2E2',
      badgeColor: '#B91C1C',
      badgeBorder: '#FECACA',
    },
    {
      id: 'UNIONBANK',
      name: 'UnionBank of the Philippines',
      methodType: 'BANK' as const,
      instructions: 'Transfer to UnionBank account or scan QR code, then upload transaction receipt screenshot.',
      badgeBg: '#FEF3C7',
      badgeColor: '#D97706',
      badgeBorder: '#FDE68A',
    },
    {
      id: 'OTHER_BANK',
      name: 'Other Bank Transfer',
      methodType: 'BANK' as const,
      instructions: 'Transfer to bank account or scan QR code, then upload transaction receipt screenshot.',
      badgeBg: '#F3E8FF',
      badgeColor: '#7E22CE',
      badgeBorder: '#E9D5FF',
    },
  ];

  function getMethodProviderInfo(method: AdminPaymentMethod) {
    const name = method.displayName.toLowerCase();
    if (method.methodType === 'GCASH' || name.includes('gcash')) {
      return {
        label: 'GCash',
        type: 'GCASH',
        badgeBg: '#E0F2FE',
        badgeColor: '#0284C7',
        badgeBorder: '#BAE6FD',
        icon: '📱',
      };
    }
    if (name.includes('maya')) {
      return {
        label: 'Maya',
        type: 'BANK',
        badgeBg: '#DCFCE7',
        badgeColor: '#15803D',
        badgeBorder: '#BBF7D0',
        icon: '💚',
      };
    }
    if (name.includes('mari') || name.includes('seabank')) {
      return {
        label: 'MariBank',
        type: 'BANK',
        badgeBg: '#FFEDD5',
        badgeColor: '#C2410C',
        badgeBorder: '#FED7AA',
        icon: '🏦',
      };
    }
    if (name.includes('bdo')) {
      return {
        label: 'BDO',
        type: 'BANK',
        badgeBg: '#EFF6FF',
        badgeColor: '#1D4ED8',
        badgeBorder: '#BFDBFE',
        icon: '🏦',
      };
    }
    if (name.includes('bpi')) {
      return {
        label: 'BPI',
        type: 'BANK',
        badgeBg: '#FEE2E2',
        badgeColor: '#B91C1C',
        badgeBorder: '#FECACA',
        icon: '🏦',
      };
    }
    if (name.includes('union')) {
      return {
        label: 'UnionBank',
        type: 'BANK',
        badgeBg: '#FEF3C7',
        badgeColor: '#D97706',
        badgeBorder: '#FDE68A',
        icon: '🏦',
      };
    }
    if (method.methodType === 'CASH') {
      return {
        label: 'Cash',
        type: 'CASH',
        badgeBg: '#ECFDF5',
        badgeColor: '#047857',
        badgeBorder: '#A7F3D0',
        icon: '💵',
      };
    }
    return {
      label: 'Bank',
      type: 'BANK',
      badgeBg: '#F3E8FF',
      badgeColor: '#7E22CE',
      badgeBorder: '#E9D5FF',
      icon: '🏦',
    };
  }

  function handlePresetSelect(presetId: string) {
    const preset = PROVIDER_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setAddPaymentForm((prev) => ({
      ...prev,
      providerPreset: presetId,
      methodType: preset.methodType,
      displayName: preset.name,
      instructions: preset.instructions,
    }));
  }

  async function handleUploadPaymentQr(methodId: string | 'new', file: File) {
    const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    const MAX_FILE_SIZE = 5 * 1024 * 1024;

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      setErrorMsg('Invalid file type. Allowed formats: PNG, JPG, JPEG, WebP');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setErrorMsg('File size exceeds 5MB limit');
      return;
    }

    try {
      setUploadingQrId(methodId);
      setErrorMsg(null);
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/admin/settings/payment-methods/upload-qr', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to upload QR image');
      }

      const data = await res.json();
      const qrUrl = data.url;

      if (methodId === 'new') {
        setAddPaymentForm((prev) => ({ ...prev, qrImagePath: qrUrl }));
      } else {
        const updatedMethods = paymentMethods.map((m) =>
          m.id === methodId ? { ...m, qrImagePath: qrUrl } : m
        );
        setPaymentMethods(updatedMethods);
        const targetMethod = updatedMethods.find((m) => m.id === methodId);
        if (targetMethod) {
          await handleSavePaymentMethod(targetMethod);
        }
      }
      showSuccess('Receiving QR code uploaded successfully!');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to upload QR code');
    } finally {
      setUploadingQrId(null);
    }
  }

  async function handleCreatePaymentMethod(e: React.FormEvent) {
    e.preventDefault();
    if (!addPaymentForm.displayName.trim()) {
      setErrorMsg('Display name is required');
      return;
    }

    const fieldValidation = validatePaymentMethodRequiredFields(addPaymentForm);
    if (!fieldValidation.isValid) {
      setErrorMsg(fieldValidation.error || 'Account/Receiver name and Account/Mobile number are required');
      return;
    }

    try {
      setSaving(true);
      setErrorMsg(null);

      const res = await fetch('/api/admin/settings/payment-methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          methodType: addPaymentForm.methodType,
          displayName: addPaymentForm.displayName.trim(),
          accountName: addPaymentForm.accountName.trim() || null,
          accountNumber: sanitizeAccountNumber(addPaymentForm.accountNumber.trim()) || null,
          instructions: addPaymentForm.instructions.trim() || null,
          qrImagePath: addPaymentForm.qrImagePath,
          allowWeb: true,
          allowKiosk: true,
          isActive: addPaymentForm.isActive,
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Failed to create payment method');
      }

      const json = await res.json();
      setPaymentMethods((prev) => [...prev, json.data].sort((a, b) => a.displayOrder - b.displayOrder));
      setIsAddPaymentModalOpen(false);
      setAddPaymentForm({
        methodType: 'GCASH',
        providerPreset: 'GCASH',
        displayName: 'GCash',
        accountName: '',
        accountNumber: '',
        instructions: 'Transfer via GCash to mobile number or scan the QR code, then upload your proof screenshot.',
        qrImagePath: null,
        allowWeb: true,
        allowKiosk: true,
        isActive: true,
      });
      showSuccess(`Payment method "${json.data.displayName}" added successfully!`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create payment method');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePaymentMethod(id: string, displayName: string) {
    if (!confirm(`Are you sure you want to delete payment method "${displayName}"?`)) {
      return;
    }

    try {
      setSaving(true);
      setErrorMsg(null);

      const res = await fetch(`/api/admin/settings/payment-methods?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Failed to delete payment method');
      }

      setPaymentMethods((prev) => prev.filter((m) => m.id !== id));
      showSuccess(`Payment method "${displayName}" deleted!`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to delete payment method');
    } finally {
      setSaving(false);
    }
  }

  async function handleMovePaymentMethod(idx: number, direction: 'up' | 'down') {
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= paymentMethods.length) return;

    const updated = [...paymentMethods];
    const item = updated[idx];
    updated[idx] = updated[targetIdx];
    updated[targetIdx] = item;

    const reorderedWithOrders = updated.map((m, i) => ({
      ...m,
      displayOrder: i + 1,
    }));

    setPaymentMethods(reorderedWithOrders);

    try {
      const res = await fetch('/api/admin/settings/payment-methods', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderedIds: reorderedWithOrders.map((m) => m.id),
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Failed to reorder payment methods');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save reordered list');
      fetchSettings();
    }
  }

  // Save Payment Method
  async function handleSavePaymentMethod(method: AdminPaymentMethod) {
    const fieldValidation = validatePaymentMethodRequiredFields(method);
    if (!fieldValidation.isValid) {
      setErrorMsg(fieldValidation.error || 'Account/Receiver name and Account/Mobile number are required');
      return;
    }

    try {
      setSaving(true);
      setErrorMsg(null);

      const methodToSave = {
        ...method,
        accountName: method.accountName ? method.accountName.trim() : null,
        accountNumber: sanitizeAccountNumber(method.accountNumber) || null,
        allowWeb: method.methodType !== 'CASH',
        allowKiosk: true,
      };

      const res = await fetch('/api/admin/settings/payment-methods', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(methodToSave),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Failed to update payment method');
      }

      const json = await res.json();
      setPaymentMethods((prev) =>
        prev.map((m) => (m.id === json.data.id ? json.data : m))
      );
      showSuccess(`Payment method "${method.displayName}" updated!`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save payment method');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main data-screen-label="Settings" style={{ padding: '26px 28px 40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '22px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 3px', letterSpacing: '-0.02em' }}>
            System Settings
          </h1>
          <div style={{ fontSize: '13px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)' }}>
            Global configurations, adaptable operating hours, and payment channels for DeskAtlas
          </div>
        </div>
      </div>

      {/* Notifications */}
      {successMsg && (
        <div style={{ background: '#ECFDF5', border: '1px solid #10B981', color: '#065F46', padding: '12px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>✓</span> {successMsg}
        </div>
      )}

      {errorMsg && (
        <div style={{ background: '#FEF2F2', border: '1px solid #EF4444', color: '#991B1B', padding: '12px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>⚠</span> {errorMsg}
        </div>
      )}

      {/* Navigation Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--da-border-light)', marginBottom: '24px', overflowX: 'auto' }}>
        {tabs.map((t, i) => (
          <button 
            key={i}
            onClick={() => {
              setActiveTab(t);
              setErrorMsg(null);
            }}
            style={{ 
              background: 'none', border: 'none', padding: '10px 20px', fontSize: '13px', fontWeight: 700, 
              cursor: 'pointer', fontFamily: 'var(--da-font-family)', whiteSpace: 'nowrap',
              color: activeTab === t ? 'var(--da-brand-dark)' : 'var(--da-text-secondary)',
              borderBottom: activeTab === t ? '2px solid var(--da-brand-dark)' : '2px solid transparent'
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '14px', padding: '40px', textAlign: 'center', color: 'var(--da-text-secondary)' }}>
          Loading system settings...
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '14px', padding: '26px', maxWidth: '750px', boxShadow: 'var(--da-shadow-sm)' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 18px' }}>
            {activeTab}
          </h3>

          {/* TAB 1: Business Profile */}
          {activeTab === 'Business Profile' && (
            <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '6px' }}>Business Name</label>
                <input 
                  type="text" 
                  value={businessSettings.businessName}
                  onChange={(e) => setBusinessSettings({ ...businessSettings, businessName: e.target.value })}
                  required
                  style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', fontFamily: 'var(--da-font-family)' }} 
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '6px' }}>Contact Email</label>
                  <input 
                    type="email" 
                    value={businessSettings.contactEmail || ''}
                    onChange={(e) => setBusinessSettings({ ...businessSettings, contactEmail: e.target.value || null })}
                    placeholder="contact@example.com"
                    style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', fontFamily: 'var(--da-font-family)' }} 
                  />
                  {businessSettings.contactEmail && !isValidEmail(businessSettings.contactEmail) && (
                    <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px' }}>
                      Please enter a valid email address (e.g., contact@example.com).
                    </div>
                  )}
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '6px' }}>Contact Number</label>
                  <div 
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      border: '1px solid var(--da-border)', 
                      borderRadius: '8px', 
                      overflow: 'hidden', 
                      background: '#fff',
                    }}
                  >
                    <span 
                      style={{ 
                        padding: '10px 12px 10px 14px', 
                        fontSize: '13px', 
                        fontWeight: 600, 
                        color: 'var(--da-text-secondary)', 
                        background: '#f8fafc', 
                        borderRight: '1px solid var(--da-border)', 
                        userSelect: 'none',
                        lineHeight: 1,
                      }}
                    >
                      +63
                    </span>
                    <input 
                      type="tel" 
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={10}
                      value={phoneDigits}
                      onChange={(e) => handlePhoneChange(e.target.value)}
                      onKeyDown={(e) => handleNumericKeyDown(e)}
                      placeholder="9171234567"
                      style={{ 
                        width: '100%', 
                        border: 'none', 
                        outline: 'none', 
                        padding: '10px 14px', 
                        fontSize: '13px', 
                        fontFamily: 'var(--da-font-family)', 
                        background: 'transparent',
                      }} 
                    />
                  </div>
                  <div style={{ fontSize: '11px', color: phoneDigits && phoneDigits.length !== 10 ? '#ef4444' : 'var(--da-text-secondary)', marginTop: '4px' }}>
                    10-digit mobile number (e.g., 9171234567)
                  </div>
                </div>
              </div>

              {!businessSettings.contactEmail?.trim() && !phoneDigits && (
                <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '-6px' }}>
                  * At least one contact method (contact email or contact number) is required.
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '6px' }}>Facebook Page URL (Optional)</label>
                  <input 
                    type="url" 
                    value={businessSettings.facebookUrl || ''}
                    onChange={(e) => setBusinessSettings({ ...businessSettings, facebookUrl: e.target.value || null })}
                    placeholder="https://facebook.com/yourbusiness"
                    style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', fontFamily: 'var(--da-font-family)' }} 
                  />
                  {businessSettings.facebookUrl && !isValidUrl(businessSettings.facebookUrl) && (
                    <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px' }}>
                      Please enter a valid URL starting with http:// or https://
                    </div>
                  )}
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '6px' }}>Instagram URL (Optional)</label>
                  <input 
                    type="url" 
                    value={businessSettings.instagramUrl || ''}
                    onChange={(e) => setBusinessSettings({ ...businessSettings, instagramUrl: e.target.value || null })}
                    placeholder="https://instagram.com/yourbusiness"
                    style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', fontFamily: 'var(--da-font-family)' }} 
                  />
                  {businessSettings.instagramUrl && !isValidUrl(businessSettings.instagramUrl) && (
                    <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px' }}>
                      Please enter a valid URL starting with http:// or https://
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '6px' }}>Twitter / X URL (Optional)</label>
                  <input 
                    type="url" 
                    value={businessSettings.twitterUrl || ''}
                    onChange={(e) => setBusinessSettings({ ...businessSettings, twitterUrl: e.target.value || null })}
                    placeholder="https://x.com/yourbusiness"
                    style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', fontFamily: 'var(--da-font-family)' }} 
                  />
                  {businessSettings.twitterUrl && !isValidUrl(businessSettings.twitterUrl) && (
                    <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px' }}>
                      Please enter a valid URL starting with http:// or https://
                    </div>
                  )}
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '6px' }}>Website URL (Optional)</label>
                  <input 
                    type="url" 
                    value={businessSettings.websiteUrl || ''}
                    onChange={(e) => setBusinessSettings({ ...businessSettings, websiteUrl: e.target.value || null })}
                    placeholder="https://yourbusiness.com"
                    style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', fontFamily: 'var(--da-font-family)' }} 
                  />
                  {businessSettings.websiteUrl && !isValidUrl(businessSettings.websiteUrl) && (
                    <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px' }}>
                      Please enter a valid URL starting with http:// or https://
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '6px' }}>Timezone</label>
                  <select 
                    value={businessSettings.timezone}
                    onChange={(e) => setBusinessSettings({ ...businessSettings, timezone: e.target.value })}
                    style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', fontFamily: 'var(--da-font-family)', background: '#fff' }}
                  >
                    {TIMEZONES.map((tz) => (
                      <option key={tz.value} value={tz.value}>{tz.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '6px' }}>
                    Booking Slot Interval (Minutes)
                  </label>
                  <input 
                    type="number" 
                    min={1} 
                    max={240} 
                    value={businessSettings.bookingIntervalMinutes === '' as any ? '' : (businessSettings.bookingIntervalMinutes ?? '')}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setBusinessSettings({
                        ...businessSettings,
                        bookingIntervalMinutes: raw === '' ? ('' as any) : Number(raw),
                      });
                    }}
                    onBlur={() => {
                      const val = Number(businessSettings.bookingIntervalMinutes);
                      if (!val || val < 1) {
                        setBusinessSettings({ ...businessSettings, bookingIntervalMinutes: 15 });
                      }
                    }}
                    onKeyDown={(e) => handleNumericKeyDown(e)}
                    style={{ 
                      width: '100%', 
                      border: businessSettings.bookingIntervalMinutes !== '' as any && Number(businessSettings.bookingIntervalMinutes) < 1 ? '1px solid #ef4444' : '1px solid var(--da-border)', 
                      borderRadius: '8px', 
                      padding: '10px 14px', 
                      fontSize: '13px', 
                      fontFamily: 'var(--da-font-family)' 
                    }} 
                  />
                  {businessSettings.bookingIntervalMinutes !== '' as any && Number(businessSettings.bookingIntervalMinutes) < 1 && (
                    <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px' }}>
                      Interval must be at least 1 minute.
                    </div>
                  )}
                  <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)', marginTop: '4px' }}>
                    Minimum 1 minute. Determines time slot increments on customer and kiosk calendars.
                  </div>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '6px' }}>Online Payment Session Expiry (Minutes)</label>
                <input 
                  type="number" 
                  min={5}
                  max={1440}
                  value={businessSettings.paymentExpiryMinutes === '' as any ? '' : (businessSettings.paymentExpiryMinutes ?? '')}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setBusinessSettings({
                      ...businessSettings,
                      paymentExpiryMinutes: raw === '' ? ('' as any) : Number(raw),
                    });
                  }}
                  onBlur={() => {
                    if (!businessSettings.paymentExpiryMinutes || Number(businessSettings.paymentExpiryMinutes) < 5) {
                      setBusinessSettings({ ...businessSettings, paymentExpiryMinutes: 60 });
                    }
                  }}
                  onKeyDown={(e) => handleNumericKeyDown(e)}
                  style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', fontFamily: 'var(--da-font-family)' }} 
                />
                <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)', marginTop: '4px' }}>
                  Default is 60 minutes for online GCash/bank transfer proof submission.
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '6px' }}>Customer Reservation Session Reset Timer (Minutes)</label>
                <input 
                  type="number" 
                  min={1} 
                  max={180} 
                  value={businessSettings.customerSessionTimeoutMinutes === '' as any ? '' : (businessSettings.customerSessionTimeoutMinutes ?? 20)}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setBusinessSettings({
                      ...businessSettings,
                      customerSessionTimeoutMinutes: raw === '' ? ('' as any) : Number(raw),
                    });
                  }}
                  onBlur={() => {
                    if (!businessSettings.customerSessionTimeoutMinutes || Number(businessSettings.customerSessionTimeoutMinutes) < 1) {
                      setBusinessSettings({ ...businessSettings, customerSessionTimeoutMinutes: 20 });
                    } else if (Number(businessSettings.customerSessionTimeoutMinutes) > 180) {
                      setBusinessSettings({ ...businessSettings, customerSessionTimeoutMinutes: 180 });
                    }
                  }}
                  onKeyDown={(e) => handleNumericKeyDown(e)}
                  style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', fontFamily: 'var(--da-font-family)' }} 
                />
                <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)', marginTop: '4px' }}>
                  Default is 20 minutes. Determines when an inactive customer booking session on /reserve automatically resets.
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '6px' }}>Customer Self-Service Reschedule Notice Cutoff (Hours)</label>
                <input 
                  type="number" 
                  min={0} 
                  max={720} 
                  value={businessSettings.customerRescheduleCutoffHours === '' as any ? '' : (businessSettings.customerRescheduleCutoffHours ?? 12)}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setBusinessSettings({
                      ...businessSettings,
                      customerRescheduleCutoffHours: raw === '' ? ('' as any) : Number(raw),
                    });
                  }}
                  onBlur={() => {
                    if (businessSettings.customerRescheduleCutoffHours === undefined || businessSettings.customerRescheduleCutoffHours === null || Number(businessSettings.customerRescheduleCutoffHours) < 0) {
                      setBusinessSettings({ ...businessSettings, customerRescheduleCutoffHours: 12 });
                    } else if (Number(businessSettings.customerRescheduleCutoffHours) > 720) {
                      setBusinessSettings({ ...businessSettings, customerRescheduleCutoffHours: 720 });
                    }
                  }}
                  onKeyDown={(e) => handleNumericKeyDown(e)}
                  style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', fontFamily: 'var(--da-font-family)' }} 
                />
                <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)', marginTop: '4px' }}>
                  Default is 12 hours. Minimum notice in hours before original start time required for customer self-service rescheduling on Track Reservation.
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '6px' }}>
                  Maximum Reschedule Advance Limit
                </label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input 
                    type="number" 
                    min={1} 
                    max={businessSettings.rescheduleMaxAdvanceUnit === 'HOURS' ? 8760 : 365} 
                    value={businessSettings.rescheduleMaxAdvanceValue === '' as any ? '' : (businessSettings.rescheduleMaxAdvanceValue ?? 30)}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setBusinessSettings({
                        ...businessSettings,
                        rescheduleMaxAdvanceValue: raw === '' ? ('' as any) : Number(raw),
                      });
                    }}
                    onBlur={() => {
                      const maxLimit = businessSettings.rescheduleMaxAdvanceUnit === 'HOURS' ? 8760 : 365;
                      if (!businessSettings.rescheduleMaxAdvanceValue || Number(businessSettings.rescheduleMaxAdvanceValue) < 1) {
                        setBusinessSettings({ ...businessSettings, rescheduleMaxAdvanceValue: 30 });
                      } else if (Number(businessSettings.rescheduleMaxAdvanceValue) > maxLimit) {
                        setBusinessSettings({ ...businessSettings, rescheduleMaxAdvanceValue: maxLimit });
                      }
                    }}
                    onKeyDown={(e) => handleNumericKeyDown(e)}
                    data-testid="reschedule-max-advance-value-input"
                    style={{ flex: 1, border: '1px solid var(--da-border)', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', fontFamily: 'var(--da-font-family)' }} 
                  />
                  <select
                    value={businessSettings.rescheduleMaxAdvanceUnit || 'DAYS'}
                    onChange={(e) => {
                      const newUnit = e.target.value as 'DAYS' | 'HOURS';
                      setBusinessSettings({
                        ...businessSettings,
                        rescheduleMaxAdvanceUnit: newUnit,
                      });
                    }}
                    data-testid="reschedule-max-advance-unit-select"
                    style={{ width: '120px', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', fontFamily: 'var(--da-font-family)', background: '#fff' }}
                  >
                    <option value="DAYS">Days</option>
                    <option value="HOURS">Hours</option>
                  </select>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)', marginTop: '4px' }}>
                  Maximum distance into the future a customer or staff may reschedule a booking.
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '6px' }}>
                  Booking End-Time Alert (Minutes Before)
                </label>
                <input 
                  type="number" 
                  min={1} 
                  max={60} 
                  value={businessSettings.bookingEndAlertMinutes === '' as any ? '' : (businessSettings.bookingEndAlertMinutes ?? 5)}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setBusinessSettings({
                      ...businessSettings,
                      bookingEndAlertMinutes: raw === '' ? ('' as any) : Number(raw),
                    });
                  }}
                  onBlur={() => {
                    if (businessSettings.bookingEndAlertMinutes === undefined || businessSettings.bookingEndAlertMinutes === null || businessSettings.bookingEndAlertMinutes === '' as any || Number(businessSettings.bookingEndAlertMinutes) < 1) {
                      setBusinessSettings({ ...businessSettings, bookingEndAlertMinutes: 5 });
                    } else if (Number(businessSettings.bookingEndAlertMinutes) > 60) {
                      setBusinessSettings({ ...businessSettings, bookingEndAlertMinutes: 60 });
                    }
                  }}
                  onKeyDown={(e) => handleNumericKeyDown(e)}
                  style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', fontFamily: 'var(--da-font-family)' }} 
                />
                <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)', marginTop: '4px' }}>
                  Staff will be alerted this many minutes before a checked-in booking's end time.
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '6px' }}>
                  Maximum Advance Booking Window (Days)
                </label>
                <input 
                  type="number" 
                  min={1} 
                  max={365} 
                  value={businessSettings.maxAdvanceBookingDays === '' as any ? '' : (businessSettings.maxAdvanceBookingDays ?? 90)}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setBusinessSettings({
                      ...businessSettings,
                      maxAdvanceBookingDays: raw === '' ? ('' as any) : Number(raw),
                    });
                  }}
                  onBlur={() => {
                    if (businessSettings.maxAdvanceBookingDays === undefined || businessSettings.maxAdvanceBookingDays === null || (businessSettings.maxAdvanceBookingDays as unknown) === '' || Number(businessSettings.maxAdvanceBookingDays) < 1) {
                      setBusinessSettings({ ...businessSettings, maxAdvanceBookingDays: 90 });
                    } else if (Number(businessSettings.maxAdvanceBookingDays) > 365) {
                      setBusinessSettings({ ...businessSettings, maxAdvanceBookingDays: 365 });
                    }
                  }}
                  onKeyDown={(e) => handleNumericKeyDown(e)}
                  data-testid="max-advance-booking-days-input"
                  style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', fontFamily: 'var(--da-font-family)' }} 
                />
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                  {[30, 60, 90, 120, 180].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setBusinessSettings({ ...businessSettings, maxAdvanceBookingDays: preset })}
                      style={{
                        background: businessSettings.maxAdvanceBookingDays === preset ? 'var(--da-brand-dark)' : '#F1F5F9',
                        color: businessSettings.maxAdvanceBookingDays === preset ? '#fff' : '#334155',
                        border: '1px solid #CBD5E1',
                        borderRadius: '6px',
                        padding: '4px 10px',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {preset} Days
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)', marginTop: '4px' }}>
                  Configure how far in advance customers can reserve workspaces (e.g. 50, 80, or 100 days). Dates beyond this horizon are blocked on the public calendar.
                </div>
              </div>

              {/* Workspace Status Colors Configuration Card */}
              <div style={{ borderTop: '1px solid var(--da-border-light)', paddingTop: '18px', marginTop: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--da-brand-dark)' }}>
                      Workspace Status Colors
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)', marginTop: '2px' }}>
                      Configure badge pills and interactive floor map spot colors for all operational states.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setStatusColors({ ...DEFAULT_WORKSPACE_STATUS_COLORS });
                      setBusinessSettings((prev) => ({
                        ...prev,
                        statusColors: { ...DEFAULT_WORKSPACE_STATUS_COLORS },
                      }));
                    }}
                    style={{
                      background: '#F1F5F9',
                      border: '1px solid #CBD5E1',
                      borderRadius: '6px',
                      padding: '5px 10px',
                      fontSize: '11px',
                      fontWeight: 600,
                      color: '#334155',
                      cursor: 'pointer',
                    }}
                  >
                    Reset to Defaults
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
                  {[
                    { key: 'available', label: 'Available (Bookable)', desc: 'Free & ready to reserve' },
                    { key: 'occupied', label: 'Occupied (In Use)', desc: 'Active booking or checked-in' },
                    { key: 'maintenance', label: 'Maintenance', desc: 'Repairs or temporarily out of order' },
                    { key: 'unavailable', label: 'Unavailable / Reserved', desc: 'Blocked or upcoming reservation' },
                  ].map(({ key, label, desc }) => {
                    const colorVal = statusColors[key as keyof WorkspaceStatusColors] || DEFAULT_WORKSPACE_STATUS_COLORS[key as keyof WorkspaceStatusColors];
                    const contrastText = getContrastColor(colorVal);

                    return (
                      <div
                        key={key}
                        style={{
                          border: '1px solid var(--da-border)',
                          borderRadius: '10px',
                          padding: '12px 14px',
                          background: '#FAFAFA',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '10px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontSize: '12px', fontWeight: 700, color: '#1E293B' }}>{label}</div>
                            <div style={{ fontSize: '10px', color: 'var(--da-text-secondary)' }}>{desc}</div>
                          </div>
                          {/* Live Preview Badge */}
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              padding: '3px 10px',
                              borderRadius: '9999px',
                              fontSize: '11px',
                              fontWeight: 700,
                              backgroundColor: colorVal,
                              color: contrastText,
                              border: `1px solid ${colorVal}`,
                              boxShadow: 'var(--da-shadow-sm)',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            {key.toUpperCase()}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="color"
                            aria-label={`${label} color picker`}
                            value={isValidHexColor(colorVal) ? colorVal : DEFAULT_WORKSPACE_STATUS_COLORS[key as keyof WorkspaceStatusColors]}
                            onChange={(e) => {
                              const newColor = e.target.value.toUpperCase();
                              const updated = { ...statusColors, [key]: newColor };
                              setStatusColors(updated);
                              setBusinessSettings((prev) => ({ ...prev, statusColors: updated }));
                            }}
                            style={{
                              width: '36px',
                              height: '36px',
                              padding: '0',
                              border: '1px solid var(--da-border)',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              background: 'none',
                            }}
                          />
                          <input
                            type="text"
                            aria-label={`${label} hex code`}
                            value={colorVal}
                            maxLength={7}
                            placeholder="#10B981"
                            onChange={(e) => {
                              const val = e.target.value;
                              const updated = { ...statusColors, [key]: val };
                              setStatusColors(updated);
                              setBusinessSettings((prev) => ({ ...prev, statusColors: updated }));
                            }}
                            style={{
                              flex: 1,
                              border: '1px solid var(--da-border)',
                              borderRadius: '6px',
                              padding: '8px 10px',
                              fontSize: '12px',
                              fontFamily: 'monospace',
                              fontWeight: 600,
                              background: '#fff',
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Cancellation & Rescheduling Policy Upload Card */}
              <CancellationPolicyUploader
                policyPdfUrl={businessSettings.cancellationPolicyPdfUrl}
                policyPdfFilename={businessSettings.cancellationPolicyPdfFilename}
                policyUpdatedAt={businessSettings.cancellationPolicyUpdatedAt}
                onPolicyUpdated={(data) => {
                  setBusinessSettings((prev) => ({
                    ...prev,
                    cancellationPolicyPdfUrl: data.cancellationPolicyPdfUrl,
                    cancellationPolicyPdfFilename: data.cancellationPolicyPdfFilename,
                    cancellationPolicyUpdatedAt: data.cancellationPolicyUpdatedAt,
                  }));
                }}
                showSuccess={showSuccess}
                showError={(msg) => setErrorMsg(msg)}
              />

              {(() => {
                const check = canSaveBusinessProfile({
                  businessName: businessSettings.businessName,
                  contactEmail: businessSettings.contactEmail,
                  phoneDigits,
                  bookingIntervalMinutes: businessSettings.bookingIntervalMinutes,
                  bookingEndAlertMinutes: businessSettings.bookingEndAlertMinutes,
                  rescheduleMaxAdvanceValue: businessSettings.rescheduleMaxAdvanceValue,
                  rescheduleMaxAdvanceUnit: businessSettings.rescheduleMaxAdvanceUnit,
                  maxAdvanceBookingDays: businessSettings.maxAdvanceBookingDays,
                });
                const isDisabled = saving || !check.canSave;
                return (
                  <button 
                    type="submit"
                    disabled={isDisabled}
                    title={!check.canSave ? check.reason : undefined}
                    style={{ 
                      background: 'var(--da-brand-dark)', color: '#fff', border: 'none', padding: '12px', 
                      borderRadius: '8px', fontWeight: 700, fontSize: '13px', 
                      cursor: isDisabled ? 'not-allowed' : 'pointer', 
                      marginTop: '8px', 
                      opacity: isDisabled ? 0.6 : 1 
                    }}
                  >
                    {saving ? 'Saving...' : 'Save Business Profile'}
                  </button>
                );
              })()}
            </form>
          )}

          {/* TAB 2: Business Hours (Adaptable Business Model) */}
          {activeTab === 'Business Hours' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--da-brand-dark)', marginBottom: '8px' }}>
                  Operating Hours Preset & Mode
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                  {[
                    { id: '24_7', title: '24 / 7', desc: 'Open 24 hours every day' },
                    { id: '24_HOURS_SELECTED_DAYS', title: '24h on Selected Days', desc: 'Open 24h on specific days only' },
                    { id: 'CUSTOM_HOURS', title: 'Custom Hours', desc: 'Set custom opening & closing times' },
                  ].map((m) => {
                    const isSelected = hoursMode === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handleModeChange(m.id as BusinessOperatingHoursMode)}
                        style={{
                          padding: '12px 14px',
                          border: isSelected ? '2px solid var(--da-brand-dark)' : '1px solid var(--da-border)',
                          borderRadius: '10px',
                          background: isSelected ? '#F0FDFA' : '#fff',
                          textAlign: 'left',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ fontSize: '13px', fontWeight: 700, color: isSelected ? 'var(--da-brand-dark)' : '#1E293B', marginBottom: '2px' }}>
                          {m.title}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)' }}>
                          {m.desc}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Day by Day Schedule Grid */}
              <div style={{ borderTop: '1px solid var(--da-border-light)', paddingTop: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--da-brand-dark)' }}>
                    Weekly Schedule
                  </div>
                  {hoursMode === 'CUSTOM_HOURS' && (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <button
                        type="button"
                        onClick={() => handleApplyHoursToAll(1, true)}
                        style={{
                          background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '6px',
                          padding: '4px 10px', fontSize: '11px', fontWeight: 600, color: '#334155', cursor: 'pointer'
                        }}
                      >
                        Copy Mon to all open days
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApplyHoursToAll(1, false)}
                        style={{
                          background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '6px',
                          padding: '4px 10px', fontSize: '11px', fontWeight: 600, color: '#334155', cursor: 'pointer'
                        }}
                      >
                        Copy Mon to all 7 days
                      </button>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {daySchedules.map((schedule, idx) => (
                    <div 
                      key={schedule.dayOfWeek}
                      style={{ 
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '12px 14px', background: schedule.isOpen ? '#FAFAFA' : '#F1F5F9',
                        border: '1px solid var(--da-border-light)', borderRadius: '8px'
                      }}
                    >
                      {/* Day Label & Toggle */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: '130px' }}>
                        <input 
                          type="checkbox"
                          id={`day-toggle-${schedule.dayOfWeek}`}
                          checked={schedule.isOpen}
                          disabled={hoursMode === '24_7'}
                          onChange={(e) => {
                            const updated = [...daySchedules];
                            updated[idx] = {
                              ...schedule,
                              isOpen: e.target.checked,
                              is24Hours: hoursMode === '24_HOURS_SELECTED_DAYS' ? e.target.checked : schedule.is24Hours,
                            };
                            setDaySchedules(updated);
                          }}
                          style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                        />
                        <label 
                          htmlFor={`day-toggle-${schedule.dayOfWeek}`}
                          style={{ fontSize: '13px', fontWeight: 700, color: schedule.isOpen ? '#1E293B' : '#94A3B8', cursor: 'pointer' }}
                        >
                          {DAY_NAMES[schedule.dayOfWeek]}
                        </label>
                      </div>

                      {/* Hours Display / Inputs */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {!schedule.isOpen ? (
                          <span style={{ fontSize: '12px', fontWeight: 600, color: '#94A3B8', padding: '4px 10px', background: '#E2E8F0', borderRadius: '6px' }}>
                            Closed
                          </span>
                        ) : hoursMode === '24_7' || hoursMode === '24_HOURS_SELECTED_DAYS' || schedule.is24Hours ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '12px', fontWeight: 700, color: '#0D9488', padding: '4px 12px', background: '#CCFBF1', borderRadius: '6px' }}>
                              Open 24 Hours
                            </span>
                            {hoursMode === 'CUSTOM_HOURS' && (
                              <button
                                type="button"
                                onClick={() => {
                                  const updated = [...daySchedules];
                                  updated[idx] = { ...schedule, is24Hours: false };
                                  setDaySchedules(updated);
                                }}
                                style={{ background: 'none', border: 'none', color: '#0284C7', fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }}
                              >
                                Set custom times
                              </button>
                            )}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <select 
                              aria-label={`${DAY_NAMES[schedule.dayOfWeek]} Opening Time`}
                              value={schedule.opensAt}
                              onChange={(e) => {
                                const newOpensAt = e.target.value;
                                const updated = [...daySchedules];
                                let newClosesAt = schedule.closesAt;
                                if (newOpensAt && newClosesAt && newClosesAt <= newOpensAt) {
                                  newClosesAt = getDefaultClosingTime(newOpensAt);
                                }
                                updated[idx] = { ...schedule, opensAt: newOpensAt, closesAt: newClosesAt };
                                setDaySchedules(updated);
                              }}
                              style={{ 
                                border: '1px solid var(--da-border)', 
                                borderRadius: '6px', 
                                padding: '6px 10px', 
                                fontSize: '12px',
                                background: '#fff',
                                color: '#0F172A',
                                cursor: 'pointer'
                              }}
                            >
                              {getTimeOptions(false, schedule.opensAt).map((t) => (
                                <option key={t} value={t}>
                                  {getTimeLabel(t)}
                                </option>
                              ))}
                            </select>
                            <span style={{ fontSize: '12px', color: '#64748B' }}>to</span>
                            <select 
                              aria-label={`${DAY_NAMES[schedule.dayOfWeek]} Closing Time`}
                              value={schedule.closesAt}
                              onChange={(e) => {
                                const newClosesAt = e.target.value;
                                if (newClosesAt && schedule.opensAt && newClosesAt <= schedule.opensAt) {
                                  return;
                                }
                                const updated = [...daySchedules];
                                updated[idx] = { ...schedule, closesAt: newClosesAt };
                                setDaySchedules(updated);
                              }}
                              style={{ 
                                border: '1px solid var(--da-border)', 
                                borderRadius: '6px', 
                                padding: '6px 10px', 
                                fontSize: '12px',
                                background: '#fff',
                                color: '#0F172A',
                                cursor: 'pointer'
                              }}
                            >
                              {getTimeOptions(true, schedule.closesAt).map((t) => {
                                const isUnavailable = schedule.opensAt ? t <= schedule.opensAt : false;
                                return (
                                  <option 
                                    key={t} 
                                    value={t} 
                                    disabled={isUnavailable}
                                    style={{
                                      color: isUnavailable ? '#94A3B8' : '#0F172A',
                                      backgroundColor: isUnavailable ? '#F8FAFC' : '#FFFFFF',
                                    }}
                                  >
                                    {getTimeLabel(t)} {isUnavailable ? '— Unavailable' : ''}
                                  </option>
                                );
                              })}
                            </select>
                            <button
                              type="button"
                              onClick={() => {
                                const updated = [...daySchedules];
                                updated[idx] = { ...schedule, is24Hours: true, opensAt: '00:00', closesAt: '24:00' };
                                setDaySchedules(updated);
                              }}
                              style={{ background: 'none', border: 'none', color: '#0D9488', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
                            >
                              24h
                            </button>
                            <button
                              type="button"
                              onClick={() => handleApplyHoursToAll(idx, false)}
                              title={`Apply ${DAY_NAMES[schedule.dayOfWeek]} hours (${schedule.opensAt} - ${schedule.closesAt}) to all days`}
                              style={{
                                background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px',
                                padding: '4px 8px', fontSize: '11px', fontWeight: 600, color: '#0369A1', cursor: 'pointer'
                              }}
                            >
                              Apply to all
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <button 
                type="button"
                onClick={handleSaveOperatingHours}
                disabled={saving}
                style={{ 
                  background: 'var(--da-brand-dark)', color: '#fff', border: 'none', padding: '12px', 
                  borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: saving ? 'not-allowed' : 'pointer', 
                  marginTop: '8px', opacity: saving ? 0.7 : 1 
                }}
              >
                {saving ? 'Saving...' : 'Save Business Hours'}
              </button>
            </div>
          )}

          {/* TAB 3: Payment Methods */}
          {activeTab === 'Payment Methods' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ fontSize: '12px', color: 'var(--da-text-secondary)', maxWidth: '520px' }}>
                  Configure online and in-person payment channels. Online methods support 1-hour proof uploads; counter payment methods are used for kiosk and desk transactions.
                </div>
                <button
                  type="button"
                  onClick={() => {
                    handlePresetSelect('GCASH');
                    setIsAddPaymentModalOpen(true);
                  }}
                  style={{
                    background: 'var(--da-brand-dark)',
                    color: '#fff',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <span>+</span> Add Payment Method
                </button>
              </div>

              {paymentMethods.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px 20px', color: '#94A3B8', border: '1px dashed var(--da-border)', borderRadius: '10px' }}>
                  No payment methods configured yet. Click <strong>+ Add Payment Method</strong> above to add GCash or Bank options.
                </div>
              ) : (
                paymentMethods.map((method, idx) => {
                  const providerInfo = getMethodProviderInfo(method);
                  const isFirst = idx === 0;
                  const isLast = idx === paymentMethods.length - 1;
                  const isUploadingQr = uploadingQrId === method.id;

                  return (
                    <div 
                      key={method.id}
                      style={{ 
                        border: '1px solid var(--da-border)', borderRadius: '12px', padding: '20px',
                        background: method.isActive ? '#FFFFFF' : '#F8FAFC',
                        boxShadow: 'var(--da-shadow-sm)',
                      }}
                    >
                      {/* Top bar: Provider Badge, Display Name, Move Up/Down, Active Toggle, Delete */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: '240px' }}>
                          <span style={{ 
                            fontSize: '11px', fontWeight: 800, padding: '4px 10px', borderRadius: '6px',
                            background: providerInfo.badgeBg,
                            color: providerInfo.badgeColor,
                            border: `1px solid ${providerInfo.badgeBorder}`,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}>
                            <span>{providerInfo.icon}</span>
                            <span>{providerInfo.label}</span>
                          </span>
                          <input 
                            type="text"
                            value={method.displayName}
                            onChange={(e) => {
                              const updated = [...paymentMethods];
                              updated[idx] = { ...method, displayName: e.target.value };
                              setPaymentMethods(updated);
                            }}
                            placeholder="Display Name"
                            style={{ fontWeight: 700, fontSize: '14px', border: '1px solid var(--da-border)', borderRadius: '6px', padding: '6px 10px', flex: 1, minWidth: '160px' }}
                          />
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {/* Reordering Buttons */}
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button
                              type="button"
                              onClick={() => handleMovePaymentMethod(idx, 'up')}
                              disabled={isFirst}
                              title="Move Up"
                              style={{
                                padding: '4px 8px', fontSize: '11px', fontWeight: 700,
                                background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '6px',
                                cursor: isFirst ? 'not-allowed' : 'pointer',
                                opacity: isFirst ? 0.4 : 1,
                              }}
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMovePaymentMethod(idx, 'down')}
                              disabled={isLast}
                              title="Move Down"
                              style={{
                                padding: '4px 8px', fontSize: '11px', fontWeight: 700,
                                background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '6px',
                                cursor: isLast ? 'not-allowed' : 'pointer',
                                opacity: isLast ? 0.4 : 1,
                              }}
                            >
                              ▼
                            </button>
                          </div>

                          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', margin: '0 6px' }}>
                            <input 
                              type="checkbox"
                              checked={method.isActive}
                              onChange={(e) => {
                                const updated = [...paymentMethods];
                                updated[idx] = { ...method, isActive: e.target.checked };
                                setPaymentMethods(updated);
                              }}
                              style={{ cursor: 'pointer' }}
                            />
                            {method.isActive ? 'Active' : 'Inactive'}
                          </label>

                          <button
                            type="button"
                            onClick={() => handleDeletePaymentMethod(method.id, method.displayName)}
                            title="Delete Payment Method"
                            style={{
                              background: '#FEE2E2', border: '1px solid #F87171', color: '#991B1B',
                              padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer'
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>

                      {/* Account Details */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                        <div>
                          <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '4px' }}>
                            Account / Receiver Name <span style={{ color: '#EF4444' }}>*</span>
                          </label>
                          <input 
                            type="text"
                            value={method.accountName || ''}
                            onChange={(e) => {
                              const updated = [...paymentMethods];
                              updated[idx] = { ...method, accountName: e.target.value };
                              setPaymentMethods(updated);
                            }}
                            placeholder="e.g. DeskAtlas Manila Inc."
                            required={method.methodType !== 'CASH'}
                            style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '6px', padding: '8px 10px', fontSize: '12px' }}
                          />
                        </div>
                        <div>
                          <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '4px' }}>
                            Account / Mobile Number <span style={{ color: '#EF4444' }}>*</span>
                          </label>
                          <input 
                            type="text"
                            value={method.accountNumber || ''}
                            onKeyDown={(e) => handleNumericKeyDown(e, { allowDash: true })}
                            onChange={(e) => {
                              const sanitized = sanitizeAccountNumber(e.target.value);
                              const updated = [...paymentMethods];
                              updated[idx] = { ...method, accountNumber: sanitized };
                              setPaymentMethods(updated);
                            }}
                            placeholder="e.g. 09171234567 or 1234-5678-9012"
                            required={method.methodType !== 'CASH'}
                            style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '6px', padding: '8px 10px', fontSize: '12px' }}
                          />
                        </div>
                      </div>

                      {/* Customer Instructions */}
                      <div style={{ marginBottom: '14px' }}>
                        <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '4px' }}>
                          Customer Instructions
                        </label>
                        <textarea 
                          rows={2}
                          value={method.instructions || ''}
                          onChange={(e) => {
                            const updated = [...paymentMethods];
                            updated[idx] = { ...method, instructions: e.target.value || null };
                            setPaymentMethods(updated);
                          }}
                          placeholder="Instructions displayed on customer payment screen..."
                          style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '6px', padding: '8px 10px', fontSize: '12px', fontFamily: 'var(--da-font-family)' }}
                        />
                      </div>

                      {/* Receiving QR Code Asset */}
                      <div style={{ background: '#F8FAFC', border: '1px solid var(--da-border-light)', borderRadius: '8px', padding: '12px 14px', marginBottom: '14px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '8px' }}>
                          Receiving QR Code Asset
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                          {method.qrImagePath ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                              <div
                                onClick={() => setViewingQrUrl(method.qrImagePath)}
                                title="Click to enlarge"
                                style={{
                                  width: '56px',
                                  height: '56px',
                                  borderRadius: '6px',
                                  border: '1px solid var(--da-border)',
                                  background: '#fff',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  overflow: 'hidden',
                                  cursor: 'pointer',
                                }}
                              >
                                <img
                                  src={method.qrImagePath}
                                  alt={`${method.displayName} QR`}
                                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                                />
                              </div>
                              <div>
                                <div style={{ fontSize: '12px', fontWeight: 600, color: '#0F172A', marginBottom: '4px' }}>
                                  QR Code Uploaded
                                </div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <label style={{
                                    fontSize: '11px', fontWeight: 600, color: '#0284C7', cursor: isUploadingQr ? 'wait' : 'pointer',
                                    background: '#E0F2FE', padding: '3px 8px', borderRadius: '4px', border: '1px solid #BAE6FD'
                                  }}>
                                    {isUploadingQr ? 'Uploading...' : 'Replace QR'}
                                    <input
                                      type="file"
                                      accept="image/png,image/jpeg,image/jpg,image/webp"
                                      disabled={isUploadingQr}
                                      onChange={(e) => {
                                        const f = e.target.files?.[0];
                                        if (f) handleUploadPaymentQr(method.id, f);
                                      }}
                                      style={{ display: 'none' }}
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const updated = [...paymentMethods];
                                      updated[idx] = { ...method, qrImagePath: null };
                                      setPaymentMethods(updated);
                                    }}
                                    style={{
                                      fontSize: '11px', fontWeight: 600, color: '#991B1B',
                                      background: '#FEE2E2', padding: '3px 8px', borderRadius: '4px', border: '1px solid #FECACA',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <label style={{
                                fontSize: '12px', fontWeight: 700, color: 'var(--da-brand-dark)',
                                background: '#FFFFFF', border: '1px solid var(--da-border)', borderRadius: '6px',
                                padding: '6px 12px', cursor: isUploadingQr ? 'wait' : 'pointer',
                                display: 'inline-flex', alignItems: 'center', gap: '6px'
                              }}>
                                <span>📷</span> {isUploadingQr ? 'Uploading...' : 'Upload Receiving QR'}
                                <input
                                  type="file"
                                  accept="image/png,image/jpeg,image/jpg,image/webp"
                                  disabled={isUploadingQr}
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) handleUploadPaymentQr(method.id, f);
                                  }}
                                  style={{ display: 'none' }}
                                />
                              </label>
                              <span style={{ fontSize: '11px', color: '#94A3B8' }}>
                                Optional receiving QR for customers to scan (PNG, JPG, WebP up to 5MB)
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Bottom bar: Save button */}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', borderTop: '1px solid var(--da-border-light)', paddingTop: '12px', flexWrap: 'wrap', gap: '10px' }}>
                        {(() => {
                          const isInvalid = !validatePaymentMethodRequiredFields(method).isValid;
                          const isDisabled = saving || isInvalid;
                          return (
                            <button
                              type="button"
                              onClick={() => handleSavePaymentMethod(method)}
                              disabled={isDisabled}
                              title={isInvalid ? 'Account/Receiver name and Account/Mobile number are required' : undefined}
                              style={{ 
                                background: 'var(--da-brand-dark)', color: '#fff', border: 'none', padding: '7px 18px', 
                                borderRadius: '6px', fontSize: '12px', fontWeight: 700, cursor: isDisabled ? 'not-allowed' : 'pointer',
                                opacity: isDisabled ? 0.6 : 1,
                              }}
                            >
                              {saving ? 'Saving...' : 'Save Method'}
                            </button>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB 4: Closures & Holidays */}
          {activeTab === 'Closures & Holidays' && (() => {
            const currentYear = calendarMonth.getFullYear();
            const currentMonth = calendarMonth.getMonth();
            const monthName = calendarMonth.toLocaleString('default', { month: 'long', year: 'numeric' });

            const firstDayOfWeek = new Date(currentYear, currentMonth, 1).getDay();
            const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

            const calendarDays: Array<{ dateStr: string; dayNum: number; isCurrentMonth: boolean; exception?: BusinessClosureException }> = [];

            // Previous month trailing days
            const prevMonthDays = new Date(currentYear, currentMonth, 0).getDate();
            for (let i = firstDayOfWeek - 1; i >= 0; i--) {
              const d = prevMonthDays - i;
              const prevM = currentMonth === 0 ? 12 : currentMonth;
              const prevY = currentMonth === 0 ? currentYear - 1 : currentYear;
              const dateStr = `${prevY}-${String(prevM).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
              calendarDays.push({ dateStr, dayNum: d, isCurrentMonth: false });
            }

            // Current month days
            for (let d = 1; d <= daysInMonth; d++) {
              const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
              const matchedException = closures.find((c) => {
                if (c.date === dateStr) return true;
                if (c.endDate && dateStr >= c.date && dateStr <= c.endDate) return true;
                return false;
              });
              calendarDays.push({ dateStr, dayNum: d, isCurrentMonth: true, exception: matchedException });
            }

            // Next month leading days to complete grid
            const remainingCells = (7 - (calendarDays.length % 7)) % 7;
            for (let d = 1; d <= remainingCells; d++) {
              const nextM = currentMonth === 11 ? 1 : currentMonth + 2;
              const nextY = currentMonth === 11 ? currentYear + 1 : currentYear;
              const dateStr = `${nextY}-${String(nextM).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
              calendarDays.push({ dateStr, dayNum: d, isCurrentMonth: false });
            }

            const selectedException = closures.find((c) => {
              if (c.date === selectedDate) return true;
              if (c.endDate && selectedDate >= c.date && selectedDate <= c.endDate) return true;
              return false;
            });

            const todayStr = getTodayDateString(businessSettings.timezone);
            const isSelectedDatePast = isPastDate(selectedDate, businessSettings.timezone);

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div style={{ fontSize: '13px', color: 'var(--da-text-secondary)', lineHeight: '1.5' }}>
                  Select a date on the calendar to mark whole-facility closures or adjust opening hours for specific holidays and maintenance events.
                </div>

                {/* Calendar Header & Grid */}
                <div style={{ border: '1px solid var(--da-border)', borderRadius: '12px', padding: '18px', background: '#FAFAFA' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                    <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--da-brand-dark)' }}>
                      {monthName}
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        type="button"
                        onClick={() => setCalendarMonth(new Date(currentYear, currentMonth - 1, 1))}
                        style={{ padding: '6px 12px', background: '#fff', border: '1px solid var(--da-border)', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '12px' }}
                      >
                        ← Prev
                      </button>
                      <button
                        type="button"
                        onClick={() => setCalendarMonth(new Date())}
                        style={{ padding: '6px 12px', background: '#fff', border: '1px solid var(--da-border)', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '12px' }}
                      >
                        Today
                      </button>
                      <button
                        type="button"
                        onClick={() => setCalendarMonth(new Date(currentYear, currentMonth + 1, 1))}
                        style={{ padding: '6px 12px', background: '#fff', border: '1px solid var(--da-border)', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '12px' }}
                      >
                        Next →
                      </button>
                    </div>
                  </div>

                  {/* Days of week header */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', marginBottom: '6px' }}>
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((dw, i) => (
                      <div key={i} style={{ fontSize: '11px', fontWeight: 700, color: '#64748B', padding: '4px 0' }}>
                        {dw}
                      </div>
                    ))}
                  </div>

                  {/* Month grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
                    {calendarDays.map((cell, idx) => {
                      const isSelected = cell.dateStr === selectedDate;
                      const todayStr = getTodayDateString(businessSettings.timezone);
                      const isToday = cell.dateStr === todayStr;
                      const isPast = cell.dateStr < todayStr;
                      const hasClosure = Boolean(cell.exception);
                      const isFullDay = cell.exception?.closureType === 'FULL_DAY';
                      const isCellDisabled = isPast && !hasClosure;

                      return (
                        <button
                          key={idx}
                          type="button"
                          disabled={isCellDisabled}
                          title={isCellDisabled ? 'Past dates cannot be selected for closures or holidays' : undefined}
                          onClick={() => {
                            setSelectedDate(cell.dateStr);
                            if (cell.exception) {
                              setClosureType(cell.exception.closureType);
                              if (cell.exception.opensAt) setSpecialOpensAt(cell.exception.opensAt);
                              if (cell.exception.closesAt) setSpecialClosesAt(cell.exception.closesAt);
                              setClosureReason(cell.exception.reason || '');
                              setIsMultiDay(Boolean(cell.exception.endDate));
                              setClosureEndDate(cell.exception.endDate || '');
                            }
                          }}
                          style={{
                            height: '70px',
                            padding: '6px',
                            background: isSelected
                              ? '#F0FDFA'
                              : hasClosure
                              ? isFullDay
                                ? '#FEF2F2'
                                : '#FFFBEB'
                              : isPast
                              ? '#F1F5F9'
                              : cell.isCurrentMonth
                              ? '#FFFFFF'
                              : '#F8FAFC',
                            border: isSelected
                              ? '2px solid var(--da-brand-dark)'
                              : hasClosure
                              ? isFullDay
                                ? '1px solid #FECACA'
                                : '1px solid #FDE68A'
                              : '1px solid var(--da-border-light)',
                            borderRadius: '8px',
                            textAlign: 'left',
                            cursor: isCellDisabled ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            opacity: isCellDisabled ? 0.35 : cell.isCurrentMonth ? 1 : 0.45,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{
                              fontSize: '12px',
                              fontWeight: isToday || isSelected ? 800 : 600,
                              color: isToday ? '#0284C7' : '#1E293B',
                            }}>
                              {cell.dayNum}
                            </span>
                            {isToday && (
                              <span style={{ fontSize: '9px', fontWeight: 800, color: '#0284C7', background: '#E0F2FE', padding: '1px 4px', borderRadius: '4px' }}>
                                TODAY
                              </span>
                            )}
                          </div>

                          {cell.exception && (
                            <div style={{
                              fontSize: '9px',
                              fontWeight: 700,
                              padding: '2px 4px',
                              borderRadius: '4px',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              background: isFullDay ? '#EF4444' : '#F59E0B',
                              color: '#fff',
                            }}>
                              {isFullDay ? 'Closed' : `${cell.exception.opensAt}-${cell.exception.closesAt}`}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Date Exception Action Card */}
                <div style={{ border: '1px solid var(--da-border)', borderRadius: '12px', padding: '20px', background: '#FFFFFF' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--da-brand-dark)' }}>
                        Configure Date Exception
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--da-text-secondary)' }}>
                        Selected Date: <strong style={{ color: '#0F172A' }}>{selectedDate}</strong>
                        {selectedException && (
                          <span style={{ marginLeft: '8px', color: selectedException.closureType === 'FULL_DAY' ? '#DC2626' : '#D97706', fontWeight: 700 }}>
                            (Currently: {selectedException.closureType === 'FULL_DAY' ? 'Closed Full Day' : `Special Hours ${selectedException.opensAt}-${selectedException.closesAt}`})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <form onSubmit={handleSaveClosure} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {isSelectedDatePast && (
                      <div
                        style={{
                          background: '#FEF2F2',
                          border: '1px solid #FECACA',
                          borderRadius: '8px',
                          padding: '10px 14px',
                          color: '#991B1B',
                          fontSize: '12px',
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}
                      >
                        <span>⚠️</span>
                        <span>Closures and holidays cannot be set or modified for past dates.</span>
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '6px' }}>
                          Selected Date
                        </label>
                        <input
                          type="date"
                          min={todayStr}
                          value={selectedDate}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val && val < todayStr) {
                              setErrorMsg('Closures and holidays cannot be set for past dates.');
                              return;
                            }
                            setSelectedDate(val);
                          }}
                          required
                          style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px' }}
                        />
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '6px' }}>
                          Exception Mode
                        </label>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            type="button"
                            onClick={() => setClosureType('FULL_DAY')}
                            style={{
                              flex: 1,
                              padding: '8px 10px',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              border: closureType === 'FULL_DAY' ? '2px solid #EF4444' : '1px solid var(--da-border)',
                              background: closureType === 'FULL_DAY' ? '#FEF2F2' : '#fff',
                              color: closureType === 'FULL_DAY' ? '#991B1B' : '#475569',
                            }}
                          >
                            🚫 Closed Full Day
                          </button>
                          <button
                            type="button"
                            onClick={() => setClosureType('SPECIAL_HOURS')}
                            style={{
                              flex: 1,
                              padding: '8px 10px',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              border: closureType === 'SPECIAL_HOURS' ? '2px solid #F59E0B' : '1px solid var(--da-border)',
                              background: closureType === 'SPECIAL_HOURS' ? '#FFFBEB' : '#fff',
                              color: closureType === 'SPECIAL_HOURS' ? '#92400E' : '#475569',
                            }}
                          >
                            ⏱️ Special Opening Hours
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Conditional Controls for Full Day / Special Hours */}
                    {closureType === 'FULL_DAY' ? (
                      <div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', marginBottom: '8px' }}>
                          <input
                            type="checkbox"
                            checked={isMultiDay}
                            onChange={(e) => setIsMultiDay(e.target.checked)}
                          />
                          Multi-day closure period
                        </label>
                        {isMultiDay && (
                          <div>
                            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '4px' }}>
                              End Date (Inclusive)
                            </label>
                            <input
                              type="date"
                              min={selectedDate && selectedDate > todayStr ? selectedDate : todayStr}
                              value={closureEndDate}
                              onChange={(e) => {
                                const val = e.target.value;
                                const minAllowed = selectedDate && selectedDate > todayStr ? selectedDate : todayStr;
                                if (val && val < minAllowed) {
                                  setErrorMsg('Closure end date cannot be in the past or before the start date.');
                                  return;
                                }
                                setClosureEndDate(val);
                              }}
                              required={isMultiDay}
                              style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px' }}
                            />
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div>
                          <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '6px' }}>
                            Opening Time on this Date
                          </label>
                          <select
                            value={specialOpensAt}
                            onChange={(e) => {
                              const newOpensAt = e.target.value;
                              setSpecialOpensAt(newOpensAt);
                              if (newOpensAt && specialClosesAt && specialClosesAt <= newOpensAt) {
                                setSpecialClosesAt(getDefaultClosingTime(newOpensAt));
                              }
                            }}
                            required
                            style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px', background: '#fff', cursor: 'pointer' }}
                          >
                            {getTimeOptions(false, specialOpensAt).map((t) => (
                              <option key={t} value={t}>
                                {getTimeLabel(t)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '6px' }}>
                            Closing Time on this Date
                          </label>
                          <select
                            value={specialClosesAt}
                            onChange={(e) => {
                              const newClosesAt = e.target.value;
                              if (newClosesAt && specialOpensAt && newClosesAt <= specialOpensAt) {
                                return;
                              }
                              setSpecialClosesAt(newClosesAt);
                            }}
                            required
                            style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px', background: '#fff', cursor: 'pointer' }}
                          >
                            {getTimeOptions(true, specialClosesAt).map((t) => {
                              const isUnavailable = specialOpensAt ? t <= specialOpensAt : false;
                              return (
                                <option
                                  key={t}
                                  value={t}
                                  disabled={isUnavailable}
                                  style={{
                                    color: isUnavailable ? '#94A3B8' : '#0F172A',
                                    backgroundColor: isUnavailable ? '#F8FAFC' : '#FFFFFF',
                                  }}
                                >
                                  {getTimeLabel(t)} {isUnavailable ? '— Unavailable' : ''}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                      </div>
                    )}

                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '6px' }}>
                        Reason / Holiday Name (Optional)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Christmas Day, New Year Holiday, Planned Facility Maintenance..."
                        value={closureReason}
                        onChange={(e) => setClosureReason(e.target.value)}
                        style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px' }}
                      />
                    </div>

                    <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                      <button
                        type="submit"
                        disabled={saving || isSelectedDatePast}
                        style={{
                          background: isSelectedDatePast ? '#94A3B8' : 'var(--da-brand-dark)',
                          color: '#fff',
                          border: 'none',
                          padding: '10px 18px',
                          borderRadius: '8px',
                          fontWeight: 700,
                          fontSize: '13px',
                          cursor: (saving || isSelectedDatePast) ? 'not-allowed' : 'pointer',
                          opacity: (saving || isSelectedDatePast) ? 0.6 : 1,
                        }}
                      >
                        {isSelectedDatePast ? 'Cannot Set Past Date' : saving ? 'Saving...' : 'Save Date Exception'}
                      </button>
                      {selectedException && (
                        <button
                          type="button"
                          onClick={() => handleDeleteClosure(selectedException)}
                          disabled={saving}
                          style={{
                            background: '#FEE2E2',
                            color: '#991B1B',
                            border: '1px solid #FECACA',
                            padding: '10px 16px',
                            borderRadius: '8px',
                            fontWeight: 700,
                            fontSize: '13px',
                            cursor: 'pointer',
                          }}
                        >
                          Delete Exception for this Date
                        </button>
                      )}
                    </div>
                  </form>
                </div>

                {/* Scheduled Closures & Holidays List */}
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--da-brand-dark)', marginBottom: '10px' }}>
                    Active & Upcoming Closures ({closures.length})
                  </div>

                  {closuresLoading ? (
                    <div style={{ padding: '16px', textAlign: 'center', color: 'var(--da-text-secondary)', fontSize: '12px' }}>
                      Loading closures...
                    </div>
                  ) : closures.length === 0 ? (
                    <div style={{ padding: '24px', textAlign: 'center', color: '#94A3B8', border: '1px dashed var(--da-border)', borderRadius: '8px', fontSize: '12px' }}>
                      No closures or holiday exceptions scheduled. Select a date above to schedule one.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {closures.map((exc) => (
                        <div
                          key={exc.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '12px 16px',
                            border: '1px solid var(--da-border-light)',
                            borderRadius: '8px',
                            background: exc.closureType === 'FULL_DAY' ? '#FEF2F2' : '#FFFBEB',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 800,
                                padding: '3px 8px',
                                borderRadius: '4px',
                                background: exc.closureType === 'FULL_DAY' ? '#EF4444' : '#F59E0B',
                                color: '#fff',
                              }}
                            >
                              {exc.closureType === 'FULL_DAY' ? 'CLOSED' : 'SPECIAL HOURS'}
                            </span>
                            <div>
                              <div style={{ fontSize: '13px', fontWeight: 700, color: '#1E293B' }}>
                                {exc.date}{exc.endDate ? ` → ${exc.endDate}` : ''}
                                {exc.closureType === 'SPECIAL_HOURS' && ` (${exc.opensAt} - ${exc.closesAt})`}
                              </div>
                              {exc.reason && (
                                <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)' }}>
                                  {exc.reason}
                                </div>
                              )}
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedDate(exc.date);
                                setClosureType(exc.closureType);
                                if (exc.opensAt) setSpecialOpensAt(exc.opensAt);
                                if (exc.closesAt) setSpecialClosesAt(exc.closesAt);
                                setClosureReason(exc.reason || '');
                                setIsMultiDay(Boolean(exc.endDate));
                                setClosureEndDate(exc.endDate || '');
                              }}
                              style={{
                                background: '#fff',
                                border: '1px solid var(--da-border)',
                                borderRadius: '6px',
                                padding: '4px 10px',
                                fontSize: '11px',
                                fontWeight: 700,
                                color: '#334155',
                                cursor: 'pointer',
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteClosure(exc)}
                              style={{
                                background: '#fff',
                                border: '1px solid #FECACA',
                                borderRadius: '6px',
                                padding: '4px 10px',
                                fontSize: '11px',
                                fontWeight: 700,
                                color: '#DC2626',
                                cursor: 'pointer',
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Closure Impact Collision Warning Modal */}
                {showImpactModal && impactPreview && (
                  <div
                    style={{
                      position: 'fixed',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: 'rgba(15, 23, 42, 0.65)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 1000,
                      padding: '20px',
                    }}
                  >
                    <div
                      style={{
                        background: '#FFFFFF',
                        borderRadius: '16px',
                        maxWidth: '640px',
                        width: '100%',
                        maxHeight: '90vh',
                        display: 'flex',
                        flexDirection: 'column',
                        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                        border: '1px solid var(--da-border)',
                        overflow: 'hidden',
                      }}
                    >
                      {/* Modal Header */}
                      <div
                        style={{
                          padding: '20px 24px',
                          borderBottom: '1px solid var(--da-border-light)',
                          background: '#FFFBEB',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                        }}
                      >
                        <div
                          style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: '10px',
                            background: '#FDE68A',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '20px',
                          }}
                        >
                          ⚠️
                        </div>
                        <div>
                          <div style={{ fontSize: '16px', fontWeight: 800, color: '#92400E' }}>
                            Closure Collision Warning: {impactPreview.impactedCount} Reservation(s) Impacted
                          </div>
                          <div style={{ fontSize: '12px', color: '#B45309', marginTop: '2px' }}>
                            Existing bookings overlap with the scheduled closure date ({selectedDate})
                          </div>
                        </div>
                      </div>

                      {/* Modal Content */}
                      <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ fontSize: '13px', color: '#334155', lineHeight: '1.5' }}>
                          Saving this closure will automatically flag the <strong>{impactPreview.impactedCount}</strong> colliding reservation(s) as <strong>Closure Impacted</strong> and immediately dispatch customer notice emails with self-service relocation and reschedule links.
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--da-text-secondary)', textTransform: 'uppercase' }}>
                            Impacted Reservations
                          </div>
                          <div
                            style={{
                              border: '1px solid var(--da-border)',
                              borderRadius: '8px',
                              maxHeight: '220px',
                              overflowY: 'auto',
                              background: '#F8FAFC',
                            }}
                          >
                            {impactPreview.reservations.map((r) => (
                              <div
                                key={r.reservationId}
                                style={{
                                  padding: '10px 14px',
                                  borderBottom: '1px solid var(--da-border-light)',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  fontSize: '12px',
                                }}
                              >
                                <div>
                                  <div style={{ fontWeight: 700, color: 'var(--da-brand-dark)' }}>
                                    {r.customerName} ({r.referenceCode})
                                  </div>
                                  <div style={{ color: 'var(--da-text-secondary)', fontSize: '11px' }}>
                                    {r.customerEmail} • {r.workspaceDisplayName}
                                  </div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <span
                                    style={{
                                      fontSize: '10px',
                                      fontWeight: 800,
                                      padding: '2px 6px',
                                      borderRadius: '4px',
                                      background: '#FEF3C7',
                                      color: '#92400E',
                                    }}
                                  >
                                    {r.status}
                                  </span>
                                  <div style={{ fontSize: '11px', color: '#64748B', marginTop: '2px' }}>
                                    {new Date(r.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(r.endAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div
                          style={{
                            background: '#EFF6FF',
                            border: '1px solid #BFDBFE',
                            borderRadius: '8px',
                            padding: '12px',
                            fontSize: '12px',
                            color: '#1E40AF',
                            lineHeight: '1.4',
                          }}
                        >
                          ℹ️ Front-desk staff will also see these reservations in their <strong>Closure Impacted</strong> queue for manual phone outreach if customers do not self-serve.
                        </div>
                      </div>

                      {/* Modal Footer */}
                      <div
                        style={{
                          padding: '16px 24px',
                          borderTop: '1px solid var(--da-border-light)',
                          background: '#F8FAFC',
                          display: 'flex',
                          justifyContent: 'flex-end',
                          gap: '10px',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setShowImpactModal(false)}
                          disabled={saving}
                          style={{
                            padding: '10px 18px',
                            borderRadius: '8px',
                            border: '1px solid var(--da-border)',
                            background: '#FFFFFF',
                            color: '#334155',
                            fontWeight: 700,
                            fontSize: '13px',
                            cursor: 'pointer',
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => executeSaveClosure()}
                          disabled={saving}
                          style={{
                            padding: '10px 18px',
                            borderRadius: '8px',
                            border: 'none',
                            background: '#D97706',
                            color: '#FFFFFF',
                            fontWeight: 700,
                            fontSize: '13px',
                            cursor: saving ? 'not-allowed' : 'pointer',
                            opacity: saving ? 0.7 : 1,
                          }}
                        >
                          {saving ? 'Processing Closure...' : 'Confirm Closure & Notify Customers'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}


          {/* TAB 5: Landing Preview Photos */}
          {activeTab === 'Landing Preview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
              <div>
                <div style={{ fontSize: '13px', color: 'var(--da-text-secondary)', lineHeight: '1.5' }}>
                  Upload and configure up to 3 preview photos displayed in the customer landing page carousel.
                  Adjust the position/crop within the preview frame and click <strong>Done</strong> before saving.
                </div>
              </div>

              {/* 3 Photo Slots */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {[0, 1, 2].map((slotIndex) => {
                  const photo = landingPreviewPhotos.find((p) => p.displayOrder === slotIndex) || landingPreviewPhotos[slotIndex];
                  const isAdjusting = adjustingSlot === slotIndex;
                  const isUploading = uploadingSlot === slotIndex;

                  return (
                    <div
                      key={slotIndex}
                      style={{
                        border: isAdjusting ? '2px solid var(--da-brand-dark)' : '1px solid var(--da-border)',
                        borderRadius: '12px',
                        padding: '18px',
                        background: isAdjusting ? '#F0FDFA' : '#FAFAFA',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--da-brand-dark)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: '24px', height: '24px', borderRadius: '50%', background: 'var(--da-brand-dark)',
                            color: '#fff', fontSize: '12px', fontWeight: 800
                          }}>
                            {slotIndex + 1}
                          </span>
                          <span>Preview Slide {slotIndex + 1}</span>
                          {photo && (
                            <span style={{ fontSize: '11px', fontWeight: 600, color: '#0D9488', background: '#CCFBF1', padding: '2px 8px', borderRadius: '4px' }}>
                              Configured ({photo.position?.x ?? 50}%, {photo.position?.y ?? 50}%)
                            </span>
                          )}
                        </div>

                        {photo && (
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            {isAdjusting ? (
                              <button
                                type="button"
                                onClick={() => setAdjustingSlot(null)}
                                style={{
                                  background: 'var(--da-brand-dark)',
                                  color: '#fff',
                                  border: 'none',
                                  padding: '6px 16px',
                                  borderRadius: '6px',
                                  fontSize: '12px',
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                  boxShadow: 'var(--da-shadow-sm)',
                                }}
                              >
                                ✓ Done
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setAdjustingSlot(slotIndex)}
                                style={{
                                  background: '#fff',
                                  color: '#0F172A',
                                  border: '1px solid var(--da-border)',
                                  padding: '6px 12px',
                                  borderRadius: '6px',
                                  fontSize: '12px',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                }}
                              >
                                Reposition
                              </button>
                            )}

                            <label
                              style={{
                                background: '#fff',
                                color: 'var(--da-text-primary)',
                                border: '1px solid var(--da-border)',
                                padding: '6px 12px',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'inline-block',
                              }}
                            >
                              Change
                              <input
                                type="file"
                                accept="image/png, image/jpeg, image/jpg, image/webp"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) handleUploadLandingPhoto(slotIndex, file);
                                }}
                                style={{ display: 'none' }}
                              />
                            </label>

                            <button
                              type="button"
                              onClick={() => handleRemoveLandingPhoto(slotIndex)}
                              style={{
                                background: '#FEE2E2',
                                color: '#991B1B',
                                border: '1px solid #FECACA',
                                padding: '6px 12px',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Frame Container matching Customer Landing Preview scale / ratio */}
                      {photo ? (
                        <div
                          onMouseDown={(e) => handlePhotoMouseDown(slotIndex, e)}
                          onMouseMove={(e) => handlePhotoMouseMove(slotIndex, e)}
                          onMouseUp={handlePhotoMouseUp}
                          onMouseLeave={handlePhotoMouseUp}
                          onTouchStart={(e) => handlePhotoTouchStart(slotIndex, e)}
                          onTouchMove={(e) => handlePhotoTouchMove(slotIndex, e)}
                          onTouchEnd={handlePhotoTouchEnd}
                          onClick={() => {
                            if (!isAdjusting) setAdjustingSlot(slotIndex);
                          }}
                          style={{
                            width: '100%',
                            maxWidth: '480px',
                            height: '240px',
                            borderRadius: '16px',
                            overflow: 'hidden',
                            position: 'relative',
                            background: '#E2E8F0',
                            cursor: isAdjusting ? (isDraggingPhoto ? 'grabbing' : 'grab') : 'pointer',
                            border: isAdjusting ? '2px dashed var(--da-brand-dark)' : '1px solid var(--da-border)',
                            userSelect: 'none',
                            touchAction: isAdjusting ? 'none' : 'auto',
                            boxShadow: 'var(--da-shadow-sm)',
                          }}
                        >
                          <img
                            src={photo.url}
                            alt={`Preview slide ${slotIndex + 1}`}
                            draggable={false}
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                              objectPosition: `${photo.position?.x ?? 50}% ${photo.position?.y ?? 50}%`,
                              pointerEvents: 'none',
                              userSelect: 'none',
                            }}
                          />

                          {isAdjusting ? (
                            <div style={{ position: 'absolute', top: '10px', left: '10px', pointerEvents: 'none' }}>
                              <span style={{
                                background: 'rgba(18, 37, 26, 0.9)',
                                color: '#fff',
                                fontSize: '11px',
                                fontWeight: 800,
                                padding: '4px 10px',
                                borderRadius: '6px',
                                backdropFilter: 'blur(4px)',
                              }}>
                                🖐 Drag photo to adjust crop • Click "Done" when ready
                              </span>
                            </div>
                          ) : (
                            <div style={{ position: 'absolute', bottom: '10px', right: '10px', pointerEvents: 'none' }}>
                              <span style={{
                                background: 'rgba(18, 37, 26, 0.75)',
                                color: '#fff',
                                fontSize: '11px',
                                fontWeight: 700,
                                padding: '3px 8px',
                                borderRadius: '4px',
                                backdropFilter: 'blur(4px)',
                              }}>
                                Click to reposition
                              </span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div
                          style={{
                            width: '100%',
                            maxWidth: '480px',
                            height: '180px',
                            borderRadius: '16px',
                            border: '2px dashed var(--da-border)',
                            background: '#FFFFFF',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            padding: '20px',
                            textAlign: 'center',
                          }}
                        >
                          {isUploading ? (
                            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--da-text-secondary)' }}>
                              Uploading image...
                            </div>
                          ) : (
                            <>
                              <div style={{ fontSize: '24px' }}>🖼️</div>
                              <div style={{ fontSize: '13px', fontWeight: 700, color: '#1E293B' }}>
                                No preview photo configured for Slot {slotIndex + 1}
                              </div>
                              <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)', marginBottom: '4px' }}>
                                PNG, JPG, JPEG, or WebP up to 5MB
                              </div>
                              <label
                                style={{
                                  background: 'var(--da-brand-dark)',
                                  color: '#fff',
                                  border: 'none',
                                  padding: '8px 16px',
                                  borderRadius: '8px',
                                  fontSize: '12px',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  display: 'inline-block',
                                }}
                              >
                                + Upload Photo
                                <input
                                  type="file"
                                  accept="image/png, image/jpeg, image/jpg, image/webp"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) handleUploadLandingPhoto(slotIndex, file);
                                  }}
                                  style={{ display: 'none' }}
                                />
                              </label>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Save Button */}
              <div style={{ borderTop: '1px solid var(--da-border-light)', paddingTop: '16px' }}>
                <button
                  type="button"
                  onClick={handleSaveLandingPreview}
                  disabled={saving}
                  style={{
                    background: 'var(--da-brand-dark)',
                    color: '#fff',
                    border: 'none',
                    padding: '12px 24px',
                    borderRadius: '8px',
                    fontWeight: 700,
                    fontSize: '13px',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saving ? 'Saving...' : 'Save Landing Preview Configuration'}
                </button>
              </div>
            </div>
          )}

          {/* TAB 6: Kiosk Settings */}
          {activeTab === 'Kiosk Settings' && (
            <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '6px' }}>
                  Inactivity Timeout (Minutes)
                </label>
                <input 
                  type="number" 
                  min={1}
                  max={60}
                  value={businessSettings.kioskTimeoutMinutes === '' as any ? '' : (businessSettings.kioskTimeoutMinutes ?? '')}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setBusinessSettings({
                      ...businessSettings,
                      kioskTimeoutMinutes: raw === '' ? ('' as any) : Number(raw),
                    });
                  }}
                  onBlur={() => {
                    if (!businessSettings.kioskTimeoutMinutes || Number(businessSettings.kioskTimeoutMinutes) < 1) {
                      setBusinessSettings({ ...businessSettings, kioskTimeoutMinutes: 5 });
                    }
                  }}
                  onKeyDown={(e) => handleNumericKeyDown(e)}
                  style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', fontFamily: 'var(--da-font-family)' }} 
                />
                <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)', marginTop: '4px' }}>
                  The kiosk resets automatically to the welcome screen if the user is inactive for this duration.
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '6px' }}>
                  Kiosk Booking Allowance (Minutes)
                </label>
                <input 
                  type="number" 
                  min={0}
                  max={60}
                  value={businessSettings.kioskAllowanceMinutes === '' as any ? '' : (businessSettings.kioskAllowanceMinutes ?? 5)}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setBusinessSettings({
                      ...businessSettings,
                      kioskAllowanceMinutes: raw === '' ? ('' as any) : Number(raw),
                    });
                  }}
                  onBlur={() => {
                    if (businessSettings.kioskAllowanceMinutes === undefined || businessSettings.kioskAllowanceMinutes === null || businessSettings.kioskAllowanceMinutes === '' as any || Number(businessSettings.kioskAllowanceMinutes) < 0) {
                      setBusinessSettings({ ...businessSettings, kioskAllowanceMinutes: 5 });
                    } else if (Number(businessSettings.kioskAllowanceMinutes) > 60) {
                      setBusinessSettings({ ...businessSettings, kioskAllowanceMinutes: 60 });
                    }
                  }}
                  onKeyDown={(e) => handleNumericKeyDown(e)}
                  style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', fontFamily: 'var(--da-font-family)' }} 
                />
                <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)', marginTop: '4px' }}>
                  Default is 5 minutes. Added to the current time when starting a walk-in booking session on the Kiosk.
                </div>
              </div>

              <button 
                type="submit"
                disabled={saving}
                style={{ 
                  background: 'var(--da-brand-dark)', color: '#fff', border: 'none', padding: '12px', 
                  borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: saving ? 'not-allowed' : 'pointer', 
                  marginTop: '8px', opacity: saving ? 0.7 : 1 
                }}
              >
                {saving ? 'Saving...' : 'Save Kiosk Settings'}
              </button>
            </form>
          )}
        </div>
      )}

      {/* MODAL: Add Payment Method */}
      {isAddPaymentModalOpen && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: '16px'
        }}>
          <div style={{
            background: '#FFFFFF', borderRadius: '16px', maxWidth: '580px', width: '100%',
            maxHeight: '90vh', overflowY: 'auto', padding: '24px',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 4px' }}>
                  Add Payment Method
                </h2>
                <p style={{ fontSize: '12px', color: 'var(--da-text-secondary)', margin: 0 }}>
                  Configure provider details and receiving QR asset for DeskAtlas reservations
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsAddPaymentModalOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#94A3B8' }}
              >
                ✕
              </button>
            </div>

            {/* Provider Preset Buttons */}
            <div style={{ marginBottom: '18px' }}>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '8px' }}>
                SELECT PROVIDER PRESET
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '8px' }}>
                {PROVIDER_PRESETS.map((preset) => {
                  const isSelected = addPaymentForm.providerPreset === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handlePresetSelect(preset.id)}
                      style={{
                        padding: '10px 8px',
                        borderRadius: '8px',
                        border: isSelected ? `2px solid ${preset.badgeColor}` : '1px solid var(--da-border)',
                        background: isSelected ? preset.badgeBg : '#FAFAFA',
                        color: isSelected ? preset.badgeColor : '#334155',
                        fontWeight: 700,
                        fontSize: '12px',
                        textAlign: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {preset.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <form onSubmit={handleCreatePaymentMethod} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '4px' }}>
                  DISPLAY NAME *
                </label>
                <input
                  type="text"
                  value={addPaymentForm.displayName}
                  onChange={(e) => setAddPaymentForm({ ...addPaymentForm, displayName: e.target.value })}
                  placeholder="e.g. GCash Online or Bank Transfer (MariBank)"
                  required
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--da-border)', fontSize: '13px', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '4px' }}>
                    RECEIVER / ACCOUNT NAME <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={addPaymentForm.accountName}
                    onChange={(e) => setAddPaymentForm({ ...addPaymentForm, accountName: e.target.value })}
                    placeholder="e.g. DeskAtlas Manila Inc."
                    required
                    style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--da-border)', fontSize: '13px', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '4px' }}>
                    ACCOUNT / MOBILE NUMBER <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={addPaymentForm.accountNumber}
                    onKeyDown={(e) => handleNumericKeyDown(e, { allowDash: true })}
                    onChange={(e) => setAddPaymentForm({ ...addPaymentForm, accountNumber: sanitizeAccountNumber(e.target.value) })}
                    placeholder="e.g. 09171234567 or 1234-5678-9012"
                    required
                    style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--da-border)', fontSize: '13px', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '4px' }}>
                  CUSTOMER INSTRUCTIONS
                </label>
                <textarea
                  rows={2}
                  value={addPaymentForm.instructions}
                  onChange={(e) => setAddPaymentForm({ ...addPaymentForm, instructions: e.target.value })}
                  placeholder="Instructions displayed on payment session screen..."
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--da-border)', fontSize: '12px', fontFamily: 'var(--da-font-family)', boxSizing: 'border-box' }}
                />
              </div>

              {/* Receiving QR Upload */}
              <div style={{ background: '#F8FAFC', border: '1px solid var(--da-border-light)', borderRadius: '8px', padding: '12px 14px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '6px' }}>
                  RECEIVING QR CODE (OPTIONAL)
                </label>
                {addPaymentForm.qrImagePath ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <img
                      src={addPaymentForm.qrImagePath}
                      alt="QR Preview"
                      style={{ width: '56px', height: '56px', objectFit: 'contain', borderRadius: '6px', border: '1px solid var(--da-border)', background: '#fff' }}
                    />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <label style={{
                        fontSize: '11px', fontWeight: 600, color: '#0284C7', cursor: 'pointer',
                        background: '#E0F2FE', padding: '4px 10px', borderRadius: '4px', border: '1px solid #BAE6FD'
                      }}>
                        Replace QR
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/jpg,image/webp"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleUploadPaymentQr('new', f);
                          }}
                          style={{ display: 'none' }}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => setAddPaymentForm({ ...addPaymentForm, qrImagePath: null })}
                        style={{
                          fontSize: '11px', fontWeight: 600, color: '#991B1B',
                          background: '#FEE2E2', padding: '4px 10px', borderRadius: '4px', border: '1px solid #FECACA',
                          cursor: 'pointer'
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <label style={{
                    fontSize: '12px', fontWeight: 700, color: 'var(--da-brand-dark)',
                    background: '#FFFFFF', border: '1px solid var(--da-border)', borderRadius: '6px',
                    padding: '8px 14px', cursor: uploadingQrId === 'new' ? 'wait' : 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: '6px'
                  }}>
                    <span>📷</span> {uploadingQrId === 'new' ? 'Uploading QR...' : 'Upload Receiving QR Image'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp"
                      disabled={uploadingQrId === 'new'}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleUploadPaymentQr('new', f);
                      }}
                      style={{ display: 'none' }}
                    />
                  </label>
                )}
              </div>

              {/* Status */}
              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', borderTop: '1px solid var(--da-border-light)', paddingTop: '10px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={addPaymentForm.isActive}
                    onChange={(e) => setAddPaymentForm({ ...addPaymentForm, isActive: e.target.checked })}
                  />
                  Active
                </label>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setIsAddPaymentModalOpen(false)}
                  style={{
                    background: '#F1F5F9', border: '1px solid #CBD5E1', color: '#475569',
                    padding: '10px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                {(() => {
                  const isInvalid = !validatePaymentMethodRequiredFields(addPaymentForm).isValid;
                  const isDisabled = saving || isInvalid;
                  return (
                    <button
                      type="submit"
                      disabled={isDisabled}
                      title={isInvalid ? 'Account/Receiver name and Account/Mobile number are required' : undefined}
                      style={{
                        background: 'var(--da-brand-dark)', color: '#fff', border: 'none',
                        padding: '10px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: 700,
                        cursor: isDisabled ? 'not-allowed' : 'pointer', opacity: isDisabled ? 0.6 : 1
                      }}
                    >
                      {saving ? 'Creating...' : 'Create Payment Method'}
                    </button>
                  );
                })()}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Enlarge QR Preview */}
      {viewingQrUrl && (
        <div 
          onClick={() => setViewingQrUrl(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1100, padding: '20px'
          }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '16px', padding: '20px',
              maxWidth: '360px', width: '100%', textAlign: 'center',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--da-brand-dark)' }}>
                Receiving QR Code
              </div>
              <button
                type="button"
                onClick={() => setViewingQrUrl(null)}
                style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#94A3B8' }}
              >
                ✕
              </button>
            </div>
            <img 
              src={viewingQrUrl} 
              alt="Full QR Preview"
              style={{ width: '100%', maxHeight: '300px', objectFit: 'contain', borderRadius: '8px' }}
            />
          </div>
        </div>
      )}

      {/* MODAL: Missing Contact Method Confirmation */}
      {missingContactModal.isOpen && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1100, padding: '16px'
        }}>
          <div style={{
            background: '#FFFFFF', borderRadius: '16px', maxWidth: '460px', width: '100%',
            padding: '24px',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
              <div>
                <h3 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 4px' }}>
                  Save Without Contact {missingContactModal.missingType === 'phone' ? 'Number' : 'Email'}?
                </h3>
                <p style={{ fontSize: '12px', color: 'var(--da-text-secondary)', margin: 0 }}>
                  Confirmation required for business profile settings
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMissingContactModal({ isOpen: false, missingType: null })}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#94A3B8' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '13px', color: 'var(--da-text-primary)', lineHeight: 1.5, margin: '14px 0 16px' }}>
              Are you sure you want to save without a contact {missingContactModal.missingType === 'phone' ? 'number' : 'email'}?
            </p>

            <div style={{
              background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '8px',
              padding: '12px 14px', marginBottom: '22px', fontSize: '12px', color: '#B45309',
              display: 'flex', alignItems: 'flex-start', gap: '8px', lineHeight: 1.4
            }}>
              <span style={{ fontSize: '14px', lineHeight: 1 }}>⚠️</span>
              <span>
                {missingContactModal.missingType === 'phone'
                  ? 'Customers and staff will only be able to reach your workspace via email.'
                  : 'Customers and staff will only be able to reach your workspace via phone.'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setMissingContactModal({ isOpen: false, missingType: null })}
                disabled={saving}
                style={{
                  padding: '9px 16px', borderRadius: '8px', border: '1px solid var(--da-border)',
                  background: '#fff', fontSize: '13px', fontWeight: 600, color: 'var(--da-text-secondary)',
                  cursor: saving ? 'not-allowed' : 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => executeSaveProfile()}
                disabled={saving}
                style={{
                  padding: '9px 18px', borderRadius: '8px', border: 'none',
                  background: 'var(--da-brand-dark)', fontSize: '13px', fontWeight: 700, color: '#fff',
                  cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1
                }}
              >
                {saving ? 'Saving...' : 'Confirm & Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
