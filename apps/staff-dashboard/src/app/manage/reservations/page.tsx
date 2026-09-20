import { Suspense } from 'react';
import { ReservationList } from '@/features/reservations';

export default function ReservationsPage() {
  return (
    <Suspense fallback={<div style={{ padding: '40px', textAlign: 'center' }}>Loading reservations...</div>}>
      <ReservationList />
    </Suspense>
  );
}
