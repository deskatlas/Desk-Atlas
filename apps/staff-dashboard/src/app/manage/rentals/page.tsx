"use client";

import React from "react";
import { RentalDeskPage } from "@/features/rentals";
import { useAuth } from "@/features/auth";

export default function StaffRentalsPage() {
  const { user } = useAuth();
  return <RentalDeskPage apiPrefix="/api/operations/rentals" actorRole="STAFF" staffUserId={user?.id} />;
}

