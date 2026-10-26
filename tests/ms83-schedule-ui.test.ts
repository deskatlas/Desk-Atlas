// MS83-R03/R04 / PRD-F14: exercise the real shared scheduling presentation.
import { describe, expect, it } from 'vitest';
import { createElement } from '../apps/customer-website/node_modules/react/index.js';
import { renderToStaticMarkup } from '../apps/customer-website/node_modules/react-dom/server.node.js';
import { ReservationTimeSlots } from '../apps/customer-website/src/features/reservation/components/ReservationTimeSlots';
import { ScheduleCalendarStep } from '../apps/customer-website/src/features/reservation/components/ScheduleCalendarStep';
import type { WorkspaceMapViewModel } from '../apps/customer-website/src/features/workspace-discovery/types';

const workspace: WorkspaceMapViewModel = {
  id: 'desk', workspaceInstanceId: 'desk', templateId: 'template', floorId: 'floor', floorName: 'Floor', instanceCode: 'D1',
  displayName: 'Booked Desk', templateName: 'Desk', description: 'Quiet desk', rateAmount: 900, pricingLabel: 'PHP 900/hour',
  photoPath: null, capacity: 1, status: 'available', statusLabel: 'Available', statusGlyph: '', statusTone: 'success',
  x: 0, y: 0, width: 100, height: 100, shape: 'desk',
};
describe('MS83 shared reservation schedule controls', () => {
  it('hides occupied times while another slot on the same desk stays selectable', () => {
    const html = renderToStaticMarkup(createElement(ReservationTimeSlots, {
      slots: [
        { startTime: '09:00', endTime: '11:00', isAvailable: false, blockingReason: 'RESERVATION_CONFLICT' },
        { startTime: '12:00', endTime: '14:00', isAvailable: true, blockingReason: null },
      ], selectedTime: null, durationHours: 2, onSelect: () => {},
    }));
    const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
    expect(buttons).toHaveLength(1);
    expect(html).not.toContain('9:00 AM');
    expect(html).not.toContain('Unavailable');
    expect(buttons[0][1]).not.toContain('disabled');
    expect(buttons[0][2]).toContain('12:00 PM');
  });
  it('renders clickable time cards, selected feedback and calculated end times without a dropdown', () => {
    const html = renderToStaticMarkup(createElement(ReservationTimeSlots, {
      slots: [
        { startTime: '09:00', endTime: '11:00', isAvailable: true, blockingReason: null },
        { startTime: '10:00', endTime: '12:00', isAvailable: false, blockingReason: 'RESERVATION_CONFLICT' },
        { startTime: '23:00', endTime: '01:00', isAvailable: true, blockingReason: null },
      ], selectedTime: '09:00', durationHours: 2, onSelect: () => {},
    }));
    expect(html).toContain('9:00 AM');
    expect(html).toContain('11:00 AM');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('(Next Day)');
    expect(html).not.toContain('10:00 AM');
    expect(html).not.toContain('<select');
  });
  it('uses the real calendar with locked exact duration and no new prices in reschedule mode', () => {
    const html = renderToStaticMarkup(createElement(ScheduleCalendarStep, {
      workspace, reschedule: { durationHours: 2.5, busy: false }, onBackToMap: () => {}, onContinue: () => {},
    }));
    expect(html).toContain('Select Date');
    expect(html).toContain('Previous month');
    expect(html).toContain('Next month');
    expect(html).toContain('Choose Start Time');
    expect(html).toContain('Booked duration (Locked)');
    expect(html).toContain('2.5');
    expect(html).toContain('Already paid');
    expect(html).not.toContain('900');
    expect(html).not.toContain('Estimated Total');
    expect(html).not.toContain('type="time"');
    expect(html).not.toContain('<select');
    expect(html).toContain('Select a Start Time to Proceed');
  });
  it('preserves normal reservation tier and duration choices', () => {
    const html = renderToStaticMarkup(createElement(ScheduleCalendarStep, { workspace, onBackToMap: () => {}, onContinue: () => {} }));
    expect(html).toContain('Select Booking Tier &amp; Duration');
    expect(html).toContain('Estimated Total');
    expect(html).not.toContain('Already paid');
  });
});
