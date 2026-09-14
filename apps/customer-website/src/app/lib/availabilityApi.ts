import type {
  DateAvailabilityResult,
  TimeAvailabilityResult,
  TemplateAvailabilityResult,
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
    channel: 'ONLINE',
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
    channel: 'ONLINE',
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
    channel: 'ONLINE',
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
