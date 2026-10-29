import { Header } from "@/app/components/Header";
import { CustomerServicesDashboard } from "@/features/services";
import { PrivacyNoticeLink } from "@/app/components/privacy";

export const metadata = {
  title: "Workspace Amenities & Additional Services - DeskAtlas",
  description: "Enhance your productivity with high-performance rental equipment and on-demand office services available on-site.",
};

export default function ServicesPage() {
  return (
    <main className="min-h-screen bg-[var(--da-canvas)] text-[var(--da-text-primary)]">
      <Header />
      <CustomerServicesDashboard />
      <footer className="border-t border-[var(--da-border)] bg-white mt-16">
        <div className="mx-auto flex max-w-6xl justify-end px-6 py-6 text-sm">
          <PrivacyNoticeLink />
        </div>
      </footer>
    </main>
  );
}

