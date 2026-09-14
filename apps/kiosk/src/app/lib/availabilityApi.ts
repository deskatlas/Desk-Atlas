import type {
  DateAvailabilityResult,
  TimeAvailabilityResult,
  TemplateAvailabilityResult,
  NextUpcomingBookingResult,
} from '@deskatlas/domain';

export async function fetchDateAvailability(input: {
  workspaceInstanceId: string;
  startDate: string;
  endDate: string;
  durationMinutes: number;
}): Promise<DateAvailabilityResult> {
  const params = new URLSearchParams({
    workspaceInstanceId: input.workspaceInstanceId,
    startDate: input.startDate,
    endDate: input.endDate,
    durationMinutes: String(input.durationMinutes),
  });
  const response = await fetch(`/api/availability?${params.toString()}`, {
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error ?? `Availability request failed with status ${response.status}`);
  }

  return body as DateAvailabilityResult;
}

export async function fetchTimeAvailability(input: {
  workspaceInstanceId: string;
  date: string;
  durationMinutes: number;
  nowIso?: string;
}): Promise<TimeAvailabilityResult> {
  const params = new URLSearchParams({
    workspaceInstanceId: input.workspaceInstanceId,
    date: input.date,
    durationMinutes: String(input.durationMinutes),
  });
  if (input.nowIso) {
    params.set('nowIso', input.nowIso);
  }
  const response = await fetch(`/api/availability?${params.toString()}`, {
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error ?? `Availability request failed with status ${response.status}`);
  }

  return body as TimeAvailabilityResult;
}

export async function fetchTemplateAvailability(input: {
  templateId: string;
  date: string;
  durationMinutes: number;
  startTime?: string;
  nowIso?: string;
}): Promise<TemplateAvailabilityResult> {
  const params = new URLSearchParams({
    templateId: input.templateId,
    date: input.date,
    durationMinutes: String(input.durationMinutes),
  });
  if (input.startTime) {
    params.set('startTime', input.startTime);
  }
  if (input.nowIso) {
    params.set('nowIso', input.nowIso);
  }
  const response = await fetch(`/api/availability?${params.toString()}`, {
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error ?? `Template availability request failed with status ${response.status}`);
  }

  return body as TemplateAvailabilityResult;
}

export async function fetchOccupiedInstances(input?: {
  nowIso?: string;
  durationMinutes?: number;
}): Promise<{ occupiedInstanceIds: string[]; asOf: string }> {
  const params = new URLSearchParams({
    occupiedNow: 'true',
  });
  if (input?.nowIso) {
    params.set('nowIso', input.nowIso);
  }
  if (input?.durationMinutes) {
    params.set('durationMinutes', String(input.durationMinutes));
  }
  const response = await fetch(`/api/availability?${params.toString()}`, {
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error ?? `Occupied instances request failed with status ${response.status}`);
  }

  return body as { occupiedInstanceIds: string[]; asOf: string };
}

export async function fetchNextUpcomingBooking(input: {
  workspaceInstanceId: string;
  nowIso?: string;
}): Promise<NextUpcomingBookingResult> {
  const params = new URLSearchParams({
    upcoming: 'true',
    workspaceInstanceId: input.workspaceInstanceId,
  });
  if (input.nowIso) {
    params.set('nowIso', input.nowIso);
  }
  const response = await fetch(`/api/availability?${params.toString()}`, {
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error ?? `Upcoming booking request failed with status ${response.status}`);
  }

  return body as NextUpcomingBookingResult;
}

