import { TrackingPage } from "@/features/tracking";

export default async function TrackReferenceRoute({
  params,
  searchParams,
}: {
  params: Promise<{ referenceCode: string }>;
  searchParams?: Promise<{ email?: string }>;
}) {
  const { referenceCode } = await params;
  const sp = await searchParams;
  return (
    <TrackingPage
      initialReferenceCode={decodeURIComponent(referenceCode)}
      initialEmail={sp?.email ? decodeURIComponent(sp.email) : undefined}
    />
  );
}
