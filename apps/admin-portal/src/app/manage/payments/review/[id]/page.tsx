import { PaymentReview } from "@/features/payments";

export default async function PaymentReviewDirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PaymentReview id={id} />;
}
