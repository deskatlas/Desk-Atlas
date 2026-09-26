"use client";

import { useEffect, useRef, useState } from "react";
import type { Floor, PublishedFloorMap } from "@deskatlas/domain";
import { readJson } from "@/app/lib/api";

interface PublishedMapResponse {
  floors: Floor[];
  published: PublishedFloorMap;
}

export function usePublishedMap(initialFloorId?: string) {
  const [floorId, setFloorId] = useState(initialFloorId ?? "");
  const [data, setData] = useState<PublishedMapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const cacheRef = useRef<Map<string, PublishedMapResponse>>(new Map());

  useEffect(() => {
    let cancelled = false;

    // Return cached map data instantly if available and not explicitly refetching
    if (floorId && cacheRef.current.has(floorId) && reloadToken === 0) {
      const cached = cacheRef.current.get(floorId)!;
      setData(cached);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const query = floorId ? `?floorId=${encodeURIComponent(floorId)}` : "";
    readJson<PublishedMapResponse>(`/api/published-map${query}`)
      .then((response) => {
        if (cancelled) {
          return;
        }

        if (response?.published?.floor?.id) {
          cacheRef.current.set(response.published.floor.id, response);
        }
        setData(response);
        if (!floorId && response.published?.floor?.id) {
          setFloorId(response.published.floor.id);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Unable to load the published map.");
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [floorId, reloadToken]);

  return {
    floorId,
    floors: data?.floors ?? [],
    published: data?.published ?? null,
    loading,
    error,
    setFloorId,
    refetch: () => {
      cacheRef.current.clear();
      setReloadToken((current) => current + 1);
    },
  };
}
