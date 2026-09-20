"use client";

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth';
import { SearchProvider, useSearch, ProfileDropdown } from '@deskatlas/ui';
import { NotificationBell, BookingEndAlertModal } from '@/features/alerts';

import { useRouter, usePathname } from 'next/navigation';

function StaffShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState<Date | null>(null);

  useEffect(() => {
    setCurrentTime(new Date());
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { searchQuery, setSearchQuery, clearSearch } = useSearch();
  const isReservationsPage = pathname === '/manage/reservations';

  useEffect(() => {
    if (user === null) {
      if (pathname !== '/manage') {
        router.push('/manage');
      }
    }
  }, [user, router, pathname]);

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);

  const navItems = [
    { id: '/manage', label: 'Dashboard', iconType: 'dashboard', exact: true },
    { id: '/manage/reservations', label: 'Reservations', iconType: 'reservations', exact: false },
    { id: '/manage/workspace-map', label: 'Workspace Map', iconType: 'map', exact: false },
    { id: '/manage/scan', label: 'QR Scanner', iconType: 'scan', exact: false },
    { id: '/manage/kiosk-confirm', label: 'Kiosk Queue', iconType: 'kiosk', exact: false },
    { id: '/manage/activity-log', label: 'My Activity', iconType: 'activity', exact: false },
  ];

  const getIcon = (type: string, isActive: boolean) => {
    const color = isActive ? 'var(--da-primary)' : 'currentColor';
    switch (type) {
      case 'dashboard':
        return (
          <div style={{ width: '15px', height: '15px', display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: '3px', flexShrink: 0 }}>
            <div style={{ background: color, borderRadius: '2px' }}></div><div style={{ background: color, borderRadius: '2px', opacity: isActive ? 1 : 0.55 }}></div>
            <div style={{ background: color, borderRadius: '2px', opacity: isActive ? 1 : 0.55 }}></div><div style={{ background: color, borderRadius: '2px' }}></div>
          </div>
        );
      case 'reservations':
        return (
          <div style={{ width: '15px', height: '15px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ height: '3px', background: color, borderRadius: '2px' }}></div>
            <div style={{ height: '3px', background: color, borderRadius: '2px', opacity: isActive ? 1 : 0.55 }}></div>
            <div style={{ height: '3px', background: color, borderRadius: '2px', opacity: isActive ? 1 : 0.55 }}></div>
          </div>
        );
      case 'map':
        return (
          <div style={{ width: '15px', height: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <div style={{ width: '11px', height: '11px', border: `2.5px solid ${color}`, transform: 'rotate(45deg)', borderRadius: '2px' }}></div>
          </div>
        );
      case 'scan':
        return (
          <div style={{ width: '15px', height: '15px', border: `2px solid ${color}`, borderRadius: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <div style={{ width: '5px', height: '5px', background: color }}></div>
          </div>
        );
      case 'kiosk':
        return (
          <div style={{ width: '15px', height: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
             <div style={{ width: '11px', height: '11px', border: `2.5px solid ${color}`, borderRadius: '2px' }}></div>
          </div>
        );
      case 'activity':
        return (
          <div style={{ width: '15px', height: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
          </div>
        );
      default:
        return null;
    }
  };


  if (user === null) {
    return <>{children}</>;
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex' }}>
      {/* SIDEBAR */}
      {mobileMenuOpen && (
        <div className="mobile-only" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 90 }} onClick={() => setMobileMenuOpen(false)}></div>
      )}
      <aside className={mobileMenuOpen ? 'mobile-sidebar-overlay' : 'desktop-only'} style={{ width: sidebarOpen ? '240px' : '64px', background: 'var(--da-brand-dark)', color: '#fff', display: 'flex', flexDirection: 'column', padding: '22px 16px', flexShrink: 0, transition: 'width .18s ease', overflow: 'hidden' }}>
        {sidebarOpen && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '9px', padding: '0 4px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0 }}>
              <div style={{ width: '26px', height: '26px', borderRadius: '8px', background: 'var(--da-brand-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <div style={{ width: '11px', height: '11px', borderRadius: '3px', background: 'var(--da-brand-dark)' }}></div>
              </div>
              <div style={{ whiteSpace: 'nowrap' }}>
                <div style={{ fontWeight: 800, fontSize: '15px', letterSpacing: '-0.01em', lineHeight: 1.1 }}>DeskAtlas</div>
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,.72)', fontFamily: 'var(--da-font-family)' }}>Staff Dashboard</div>
              </div>
            </div>
            <button className="desktop-only" onClick={toggleSidebar} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', background: 'transparent', border: 'none', color: 'rgba(255,255,255,.65)', borderRadius: '8px', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
              &laquo;
            </button>
            <button className="mobile-only" onClick={() => setMobileMenuOpen(false)} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', background: 'transparent', border: 'none', color: 'rgba(255,255,255,.65)', borderRadius: '8px', fontSize: '24px', cursor: 'pointer' }}>
              &times;
            </button>
          </div>
        )}
        {!sidebarOpen && (
          <button className="desktop-only" onClick={toggleSidebar} style={{ width: '100%', alignItems: 'center', justifyContent: 'center', background: 'var(--da-brand-accent)', border: 'none', color: 'var(--da-brand-dark)', borderRadius: '8px', fontSize: '16px', fontWeight: 800, cursor: 'pointer', padding: 0, height: '26px', marginBottom: '22px' }}>
            &raquo;
          </button>
        )}

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, justifyContent: 'flex-start' }}>
          {navItems.map((item, idx) => {
            const isActive = item.exact ? pathname === item.id : pathname?.startsWith(item.id);
            const navStyle = isActive ? { background: 'var(--da-brand-accent)', color: 'var(--da-brand-dark)' } : { color: 'rgba(255,255,255,.85)' };
            
            return (
              <React.Fragment key={item.id}>
                {sidebarOpen && idx === 1 && (
                  <div style={{ fontSize: '10px', fontWeight: 800, color: 'rgba(255,255,255,.55)', letterSpacing: '.09em', padding: '16px 12px 6px', fontFamily: 'var(--da-font-family)', whiteSpace: 'nowrap' }}>
                    OPERATIONS
                  </div>
                )}
                <div 
                  onClick={() => { router.push(item.id); setMobileMenuOpen(false); }} 
                  title={item.label} 
                  style={{ display: 'flex', alignItems: 'center', justifyContent: sidebarOpen ? 'flex-start' : 'center', gap: sidebarOpen ? '11px' : '0', padding: sidebarOpen ? '10px 12px' : '10px 0', borderRadius: '10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'var(--da-font-family)', ...navStyle }}
                >
                  {getIcon(item.iconType, isActive)}
                  {sidebarOpen && <span>{item.label}</span>}
                </div>
              </React.Fragment>
            );
          })}
        </nav>
      </aside>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--da-canvas)' }}>
        {/* TOP BAR */}
        <div className="mobile-w-full" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '12px 28px', background: '#fff', borderBottom: '1px solid var(--da-border)', position: 'sticky', top: 0, zIndex: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
            <button className="mobile-only" onClick={() => setMobileMenuOpen(true)} style={{ background: 'transparent', border: 'none', fontSize: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
              ☰
            </button>
            {isReservationsPage && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '9px', background: 'var(--da-canvas)', border: '1px solid var(--da-border)', borderRadius: '10px', padding: '8px 12px', flex: 1, maxWidth: '380px' }}>
                <div style={{ width: '12px', height: '12px', border: '2px solid var(--da-text-secondary)', borderRadius: '50%', flexShrink: 0 }}></div>
                <input
                  data-testid="reservations-search-input"
                  aria-label="Search reservations"
                  placeholder="Search guest name or ref ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: '13px', flex: 1, minWidth: 0, fontFamily: 'var(--da-font-family)', color: 'var(--da-text-primary)' }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={clearSearch}
                    aria-label="Clear search"
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--da-text-secondary)', fontSize: '12px', padding: '0 4px', lineHeight: 1 }}
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div className="mobile-hide" style={{ display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid var(--da-border)', borderRadius: '10px', padding: '7px 12px', fontSize: '12px', fontWeight: 600, color: 'var(--da-text-primary)', fontFamily: 'var(--da-font-family)' }}>
              <div style={{ width: '12px', height: '12px', border: '2px solid var(--da-text-secondary)', borderRadius: '3px' }}></div>
              {currentTime ? `${currentTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ${currentTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })}` : 'Loading...'}
            </div>
            <NotificationBell />
            <ProfileDropdown user={user} onLogout={logout} />
          </div>

        </div>

        {/* PAGE CONTENT */}
        {children}

        {/* BOOKING END-TIME ALERT MODAL */}
        <BookingEndAlertModal />
      </div>
    </div>
  );
}

export default function ManageLayout({ children }: { children: React.ReactNode }) {
  return (
    <SearchProvider>
      <StaffShell>{children}</StaffShell>
    </SearchProvider>
  );
}
