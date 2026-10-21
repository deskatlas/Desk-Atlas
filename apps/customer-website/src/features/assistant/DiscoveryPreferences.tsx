'use client';

import { useEffect, useState } from 'react';
import { customerDiscoveryContextSchema, type CustomerDiscoveryContext } from '@deskatlas/validation';

export function DiscoveryPreferences({ value, onSave }: {
  value: CustomerDiscoveryContext; onSave: (value: CustomerDiscoveryContext) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [notice, setNotice] = useState('');
  useEffect(() => { setDraft(value); }, [value]);
  const edit = (next: CustomerDiscoveryContext) => { setDraft(next); setNotice('Unsaved changes'); };
  return <details className="rounded-xl border border-[var(--da-border)] bg-white p-3">
    <summary className="text-sm font-bold">Schedule and preferences</summary>
    <form className="grid grid-cols-2 gap-3 pt-3" onSubmit={event => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      const candidate = { ...draft, date: String(fields.get('date') ?? '') || undefined, start_time: String(fields.get('start_time') ?? '') || undefined };
      const parsed = customerDiscoveryContextSchema.safeParse(candidate);
      if (!parsed.success) { setNotice('Check the date, time and preference values.'); return; }
      const schedule = [candidate.date, candidate.start_time, candidate.duration_minutes].filter(value => value !== undefined);
      if (schedule.length > 0 && schedule.length < 3) { setNotice('Set date, start time and duration together, or leave all three empty.'); return; }
      onSave(parsed.data); setNotice('Saved for this chat. Your next comparison will use these preferences.');
    }}>
      {value.compared_ids?.length ? <p className="col-span-2 text-xs">{value.compared_ids.length} of 3 comparison spots selected. <button type="button" className="da-secondary-button text-xs" onClick={() => onSave({ ...value, compared_ids: [] })}>Clear comparison</button></p> : null}
      <label className="text-xs">Business date (Philippine time)<input name="date" type="date" className="da-input" value={draft.date ?? ''} onInput={event => edit({ ...draft, date: event.currentTarget.value || undefined })} onChange={event => edit({ ...draft, date: event.target.value || undefined })} /></label>
      <label className="text-xs">Start time<input name="start_time" type="time" className="da-input" value={draft.start_time ?? ''} onInput={event => edit({ ...draft, start_time: event.currentTarget.value || undefined })} onChange={event => edit({ ...draft, start_time: event.target.value || undefined })} /></label>
      <label className="text-xs">Duration (hours)<input type="number" min={1 / 60} max="24" step="any" className="da-input" value={draft.duration_minutes === undefined ? '' : draft.duration_minutes / 60} onChange={event => edit({ ...draft, duration_minutes: event.target.value ? Math.round(Number(event.target.value) * 60) : undefined })} /></label>
      <label className="text-xs">Group size<input type="number" min="1" max="100" className="da-input" value={draft.preferences?.group_size ?? ''} onChange={event => edit({ ...draft, preferences: { ...draft.preferences, group_size: event.target.value ? Number(event.target.value) : undefined } })} /></label>
      <label className="text-xs">Total budget (PHP)<input type="number" min="0" max="100000" className="da-input" value={draft.preferences?.budget ?? ''} onChange={event => edit({ ...draft, preferences: { ...draft.preferences, budget: event.target.value ? Number(event.target.value) : undefined } })} /></label>
      {(['focus', 'calls', 'power'] as const).map(dimension => <label key={dimension} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.preferences?.[dimension] ?? false} onChange={event => edit({ ...draft, preferences: { ...draft.preferences, [dimension]: event.target.checked ? true : undefined } })} />{({ focus: 'Focused work', calls: 'Calls allowed', power: 'Power access' })[dimension]}</label>)}
      <button type="submit" className="da-primary-button col-span-2">Save preferences</button>
      <p role="status" className="col-span-2 text-xs text-[var(--da-text-secondary)]">{notice || 'Preferences stay in memory while this chat is open.'}</p>
    </form>
  </details>;
}
