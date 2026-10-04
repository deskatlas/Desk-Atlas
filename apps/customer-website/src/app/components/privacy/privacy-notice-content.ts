export type PrivacySection = {
  id: string;
  title: string;
  paragraphs?: string[];
  bullets?: { heading?: string; items: string[] }[];
};

/** TODO (user): replace the bracketed placeholders before going live. */
export const PRIVACY_CONTACT = {
  businessName: "[Business / Coworking Space Name]",
  privacyContact: "[Name or Position]",
  email: "thedeskatlas@gmail.com",
  address: "[Business Address]",
} as const;

export const PRIVACY_LAST_UPDATED = "September 18, 2026";

export const PRIVACY_INTRO: string[] = [
  "DeskAtlas values your privacy and takes reasonable steps to protect the personal information you provide when using our workspace booking and management system.",
  "Our privacy practices are guided by the principles of the Data Privacy Act of 2012 (Republic Act No. 10173) and relevant guidance from the National Privacy Commission (NPC).",
];

export const PRIVACY_SECTIONS: PrivacySection[] = [
  {
    id: "information-we-collect",
    title: "Information We Collect",
    bullets: [
      {
        heading: "For customers, DeskAtlas may collect:",
        items: [
          "First name",
          "Last name",
          "Email address",
          "Booking details",
          "Proof of payment and relevant payment details",
          "Survey responses, when voluntarily provided",
        ],
      },
      {
        heading: "For Super Admins, Admins, and Staff, DeskAtlas may collect:",
        items: [
          "First name",
          "Last name",
          "Email address",
          "Assigned user role and account information",
        ],
      },
    ],
    paragraphs: [
      "We only collect information that is reasonably needed to provide and manage DeskAtlas services.",
    ],
  },
  {
    id: "how-we-use",
    title: "How We Use Your Information",
    bullets: [
      {
        heading: "We may use your information to:",
        items: [
          "Create and manage workspace bookings",
          "Send booking confirmations, updates, and payment instructions",
          "Verify submitted payments",
          "Manage workspace availability and transactions",
          "Provide customer support",
          "Manage authorized Admin and Staff accounts",
          "Support the security and proper operation of DeskAtlas",
        ],
      },
    ],
  },
  {
    id: "surveys",
    title: "Surveys and Feedback",
    paragraphs: [
      "DeskAtlas may contact customers to invite them to participate in surveys or provide feedback about their experience.",
      "Participation is voluntary and choosing not to participate will not affect your booking or use of DeskAtlas.",
      "Survey responses may be used to understand customer experience and identify areas where the system and service can be improved.",
      "Customers may also request not to receive future survey invitations.",
    ],
  },
  {
    id: "access-sharing",
    title: "Access and Sharing",
    paragraphs: [
      "Personal information is only accessible to authorized personnel who need it to perform their assigned responsibilities.",
      "DeskAtlas may also use third-party services that support necessary system functions such as hosting, database and file storage, authentication, and email delivery.",
      "We do not sell personal information.",
    ],
  },
  {
    id: "protection-retention",
    title: "Data Protection and Retention",
    paragraphs: [
      "DeskAtlas uses reasonable security measures, such as account authentication, access controls, restricted administrative access, and secure storage, to help protect personal information.",
      "Customer personal information, including booking-related information and submitted proof of payment, is retained for three (3) months after the completion of the booking or transaction. After this period, the information will be deleted or anonymized when it is no longer needed.",
      "For Super Admins, Admins, and Staff, account information is retained while the account remains active. When access is no longer required, the account may be deactivated or deleted, and related personal information will be removed when it is no longer needed.",
    ],
  },
  {
    id: "your-rights",
    title: "Your Privacy Rights",
    bullets: [
      {
        heading: "You may contact us if you wish to:",
        items: [
          "Know what personal information we hold about you",
          "Request access to or correction of your information",
          "Raise concerns about how your information is being handled",
          "Request deletion or restriction of your information when appropriate",
          "Withdraw consent where the use of your information depends on your consent",
        ],
      },
    ],
    paragraphs: [
      "These practices are guided by the privacy rights and principles under the Data Privacy Act of 2012.",
    ],
  },
];

export const PRIVACY_NPC_NOTE =
  "For more information about data privacy rights in the Philippines, you may also refer to the National Privacy Commission.";
