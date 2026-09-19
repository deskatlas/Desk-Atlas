import { BookingConfirmationPage } from "@/features/booking";

export default async function PassRoute({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <BookingConfirmationPage token={token} />;
}
