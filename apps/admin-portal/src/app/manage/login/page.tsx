import { Suspense } from 'react';
import { Login } from '@/features/auth';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <Login />
    </Suspense>
  );
}
