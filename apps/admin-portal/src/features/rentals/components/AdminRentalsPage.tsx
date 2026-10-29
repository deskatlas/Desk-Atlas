"use client";

import React from "react";
import { RentalDeskPage } from "../../../../../staff-dashboard/src/features/rentals";
import { useAuth } from "@/features/auth";

export function AdminRentalsPage() {
  const { user } = useAuth();
  return (
    <RentalDeskPage
      apiPrefix="/api/admin/rentals"
      actorRole="ADMIN"
      staffUserId={user?.id}
    />
  );
}
