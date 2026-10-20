import { PromoAnalyticsDashboard } from '@/features/promo-analytics';

export const metadata = {
  title: 'Promo Analytics | DeskAtlas Admin',
  description: 'Promotional rates telemetry, discount utilization, and booking ROI reports',
};

// MS-74: PRD-F15, PRD-F25, SDD-C7, SDD-C11, SDD-C19.
export default function PromoAnalyticsPage() {
  return <PromoAnalyticsDashboard />;
}
