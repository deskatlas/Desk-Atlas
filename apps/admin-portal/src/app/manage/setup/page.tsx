import { AdminSetup } from '@/features/auth';

export const metadata = {
  title: 'Admin Setup — DeskAtlas',
  description: 'Single-use initial administrator setup for DeskAtlas',
};

export const dynamic = 'force-dynamic';

export default function SetupPage() {
  return <AdminSetup />;
}
