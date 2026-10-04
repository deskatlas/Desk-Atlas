"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import {
  PRIVACY_CONTACT,
  PRIVACY_INTRO,
  PRIVACY_LAST_UPDATED,
  PRIVACY_NPC_NOTE,
  PRIVACY_SECTIONS,
} from "./privacy-notice-content";

type PrivacyNoticeModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Controlled modal. Read-only content. No data is stored or sent. */
export function PrivacyNoticeModal({ open, onOpenChange }: PrivacyNoticeModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100%-2rem)] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-4 text-left">
          <DialogTitle>Privacy Notice</DialogTitle>
          <DialogDescription>Last updated: {PRIVACY_LAST_UPDATED}</DialogDescription>
        </DialogHeader>

        <div
          className="flex-1 space-y-6 overflow-y-auto px-6 py-5 text-sm leading-relaxed"
          tabIndex={0}
          aria-label="Privacy Notice content"
        >
          {PRIVACY_INTRO.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}

          {PRIVACY_SECTIONS.map((section) => (
            <section key={section.id} aria-labelledby={`privacy-${section.id}`} className="space-y-3">
              <h3 id={`privacy-${section.id}`} className="text-base font-semibold">
                {section.title}
              </h3>

              {section.bullets?.map((group, index) => (
                <div key={`${section.id}-${index}`} className="space-y-1.5">
                  {group.heading && <p className="font-medium">{group.heading}</p>}
                  <ul className="list-disc space-y-1 pl-5">
                    {group.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}

              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}

          <section aria-labelledby="privacy-contact" className="space-y-2">
            <h3 id="privacy-contact" className="text-base font-semibold">
              Contact Us
            </h3>
            <p>For questions, concerns, or requests regarding your personal information, please contact:</p>
            <address className="space-y-0.5 not-italic">
              <p className="font-medium">{PRIVACY_CONTACT.businessName}</p>
              <p>Privacy Contact: {PRIVACY_CONTACT.privacyContact}</p>
              <p>
                Email:{" "}
                <a className="underline underline-offset-2" href={`mailto:${PRIVACY_CONTACT.email}`}>
                  {PRIVACY_CONTACT.email}
                </a>
              </p>
              <p>Address: {PRIVACY_CONTACT.address}</p>
            </address>
            <p>{PRIVACY_NPC_NOTE}</p>
          </section>
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <Button type="button" onClick={() => onOpenChange(false)}>
            I Understand
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Drop-in trigger. Owns its own open state, so inserting it into any page
 * requires zero changes to that page's state or logic.
 */
export function PrivacyNoticeLink({
  children = "Privacy Notice",
  className = "text-teal-600 underline underline-offset-2 hover:text-teal-700",
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>
      <PrivacyNoticeModal open={open} onOpenChange={setOpen} />
    </>
  );
}
