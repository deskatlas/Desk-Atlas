import { Suspense } from 'react';
import { AdminSetupPassword } from '@/features/auth';

export const metadata = {
  title: 'Set Admin Password — DeskAtlas',
  description: 'Create initial administrator password for DeskAtlas',
};

export const dynamic = 'force-dynamic';

export default function SetupPasswordPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'radial-gradient(ellipse at top, #143527 0%, #0c1c15 50%, #070f0b 100%)',
            color: '#e2e8f0',
          }}
        >
          Loading...
        </div>
      }
    >
      <AdminSetupPassword />
    </Suspense>
  );
}
