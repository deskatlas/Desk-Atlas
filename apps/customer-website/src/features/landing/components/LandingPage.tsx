"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PublicLandingPreviewPhoto } from "@deskatlas/domain";
import { PrivacyNoticeLink } from "@/app/components/privacy";

const steps = [
  "Browse the published workspace map",
  "Choose your schedule and up to two backups",
  "Submit your reservation without holding inventory",
  "Complete payment from your one-hour email link",
];

const highlights = [
  {
    title: "Spot-first booking",
    body: "Select the exact desk, booth, or meeting room you want from the live floor map.",
  },
  {
    title: "Guest-first flow",
    body: "Reserve without creating an account. We only need your name and email.",
  },
  {
    title: "Protected confirmation",
    body: "A booking QR is issued only after proof is reviewed and a workspace is allocated.",
  },
];

export function LandingPage() {
  const [photos, setPhotos] = useState<PublicLandingPreviewPhoto[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadPreviewPhotos() {
      try {
        const res = await fetch("/api/landing-preview");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.photos)) {
            setPhotos(data.photos);
          }
        }
      } catch (err) {
        console.error("Failed to load landing preview photos:", err);
      } finally {
        setLoading(false);
      }
    }
    loadPreviewPhotos();
  }, []);

  // Automatic slide rotation with smooth fade transition
  useEffect(() => {
    if (photos.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % photos.length);
    }, 4500);
    return () => clearInterval(interval);
  }, [photos.length]);

  return (
    <main className="min-h-screen bg-[var(--da-canvas)] text-[var(--da-text-primary)]">
      <header className="border-b border-[var(--da-border)] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--da-brand-accent)] flex-shrink-0">
              <div className="h-3 w-3 rounded-[3px] bg-[var(--da-brand-dark)]" />
            </div>
            <span className="text-xl font-extrabold tracking-[-0.02em] text-[var(--da-brand-dark)]">
              DeskAtlas
            </span>
          </Link>
          <nav className="flex items-center gap-4 text-sm font-semibold text-[var(--da-text-secondary)]">
            <Link href="/reserve">Reserve</Link>
            <Link href="/track">Track Reservation</Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
        <div>
          <p className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-[var(--da-primary)]">
            Guest Booking
          </p>
          <h1 className="max-w-xl text-5xl font-extrabold leading-tight tracking-[-0.03em] text-[var(--da-brand-dark)]">
            Find the right workspace for your day.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-[var(--da-text-secondary)]">
            Explore the published floor map, pick your preferred workspace,
            choose backup options, and finish payment from a secure one-hour link.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link href="/reserve" className="da-primary-button">
              Explore Workspaces
            </Link>
            <Link href="/track" className="da-secondary-button">
              Track Reservation
            </Link>
          </div>
        </div>

        <div className="rounded-[28px] border border-[var(--da-border)] bg-white p-4 shadow-[var(--da-shadow-lg)] overflow-hidden">
          {photos.length > 0 ? (
            <div className="relative aspect-[16/10] w-full overflow-hidden rounded-[20px] bg-slate-100 border border-[var(--da-border-light)]">
              {photos.map((photo, index) => {
                const isActive = index === currentIndex;
                return (
                  <div
                    key={photo.id || index}
                    className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${
                      isActive ? "opacity-100 z-10" : "opacity-0 pointer-events-none z-0"
                    }`}
                  >
                    <img
                      src={photo.url}
                      alt={`Workspace preview ${index + 1}`}
                      className="h-full w-full object-cover"
                      style={{
                        objectPosition: `${photo.position?.x ?? 50}% ${photo.position?.y ?? 50}%`,
                      }}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-3 p-2">
              {Array.from({ length: 12 }).map((_, index) => (
                <div
                  key={index}
                  className={`aspect-square rounded-2xl ${
                    index === 2 || index === 9
                      ? "bg-[var(--da-soft)]"
                      : index === 5
                        ? "bg-[var(--da-attention)]"
                        : "bg-[var(--da-info)]"
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="border-y border-[var(--da-border)] bg-white">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <h2 className="text-center text-3xl font-extrabold text-[var(--da-brand-dark)]">
            How DeskAtlas Works
          </h2>
          <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            {steps.map((step, index) => (
              <div
                key={step}
                className="rounded-[22px] border border-[var(--da-border-light)] bg-[var(--da-canvas)] p-5"
              >
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--da-primary)] text-lg font-extrabold text-white">
                  {index + 1}
                </div>
                <p className="text-sm font-semibold leading-6 text-[var(--da-text-primary)]">
                  {step}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid gap-6 lg:grid-cols-3">
          {highlights.map((item) => (
            <article
              key={item.title}
              className="rounded-[24px] border border-[var(--da-border)] bg-white p-6 shadow-[var(--da-shadow-md)]"
            >
              <h3 className="text-xl font-extrabold text-[var(--da-brand-dark)]">
                {item.title}
              </h3>
              <p className="mt-3 text-sm leading-7 text-[var(--da-text-secondary)]">
                {item.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      <footer className="border-t border-[var(--da-border)] bg-white">
        <div className="mx-auto flex max-w-6xl justify-end px-6 py-6 text-sm">
          <PrivacyNoticeLink />
        </div>
      </footer>
    </main>
  );
}
