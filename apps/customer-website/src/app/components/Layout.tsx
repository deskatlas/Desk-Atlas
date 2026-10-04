import { Outlet, Link, useLocation } from "react-router";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { PrivacyNoticeLink } from "@/app/components/privacy";

export function Layout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  const isActive = (path: string) => {
    return location.pathname === path;
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo */}
            <Link to="/" className="flex items-center space-x-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--da-brand-accent)] flex-shrink-0">
                <div className="h-3 w-3 rounded-[3px] bg-[var(--da-brand-dark)]" />
              </div>
              <span className="font-extrabold text-gray-900 text-lg tracking-tight">DeskAtlas</span>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center space-x-8">
              <Link
                to="/"
                className={`${
                  isActive("/") ? "text-teal-600" : "text-gray-600 hover:text-gray-900"
                } transition-colors`}
              >
                Home
              </Link>
              <Link
                to="/workspaces"
                className={`${
                  isActive("/workspaces") ? "text-teal-600" : "text-gray-600 hover:text-gray-900"
                } transition-colors`}
              >
                Workspaces
              </Link>
              <Link
                to="/manage-booking"
                className="px-4 py-2 text-teal-600 border border-teal-600 rounded-lg hover:bg-teal-50 transition-colors"
              >
                Manage Booking
              </Link>
            </div>

            {/* Mobile menu button */}
            <button
              className="md:hidden p-2 rounded-lg hover:bg-gray-100"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? (
                <X className="w-6 h-6 text-gray-600" />
              ) : (
                <Menu className="w-6 h-6 text-gray-600" />
              )}
            </button>
          </div>

          {/* Mobile Navigation */}
          {mobileMenuOpen && (
            <div className="md:hidden py-4 border-t border-gray-200">
              <div className="flex flex-col space-y-4">
                <Link
                  to="/"
                  className={`${
                    isActive("/") ? "text-teal-600" : "text-gray-600"
                  } px-4 py-2`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Home
                </Link>
                <Link
                  to="/workspaces"
                  className={`${
                    isActive("/workspaces") ? "text-teal-600" : "text-gray-600"
                  } px-4 py-2`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Workspaces
                </Link>
                <Link
                  to="/manage-booking"
                  className="mx-4 px-4 py-2 text-center text-teal-600 border border-teal-600 rounded-lg"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Manage Booking
                </Link>
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* Main Content */}
      <main>
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="bg-gray-50 border-t border-gray-200 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center space-x-2 mb-4">
                <div className="w-8 h-8 bg-teal-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-semibold">W</span>
                </div>
                <span className="font-semibold text-gray-900">DeskAtlas</span>
              </div>
              <p className="text-gray-600 text-sm">
                Your premium co-working and study space.
              </p>
            </div>

            <div>
              <h4 className="font-semibold text-gray-900 mb-4">Quick Links</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li>
                  <Link to="/" className="hover:text-teal-600 transition-colors">
                    Home
                  </Link>
                </li>
                <li>
                  <Link to="/workspaces" className="hover:text-teal-600 transition-colors">
                    Workspaces
                  </Link>
                </li>
                <li>
                  <Link to="/manage-booking" className="hover:text-teal-600 transition-colors">
                    Manage Booking
                  </Link>
                </li>
                <li>
                  <PrivacyNoticeLink />
                </li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-gray-900 mb-4">Contact</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li>123 Innovation Street</li>
                <li>Tech City, TC 12345</li>
                <li>info@workspacehub.com</li>
                <li>(555) 123-4567</li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-gray-900 mb-4">Hours</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li>Monday - Friday: 7am - 10pm</li>
                <li>Saturday: 8am - 8pm</li>
                <li>Sunday: 9am - 6pm</li>
              </ul>
            </div>
          </div>

          <div className="mt-8 pt-8 border-t border-gray-200 text-center text-sm text-gray-600">
            © 2026 DeskAtlas. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
