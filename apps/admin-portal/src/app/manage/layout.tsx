"use client";

import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from '@/features/auth';
import { NotificationCenter } from '@/features/notifications';
import { SearchProvider, useSearch } from '@deskatlas/ui';
import { useRouter, usePathname } from 'next/navigation';

function AdminShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState<Date | null>(null);
  
  useEffect(() => {
    setCurrentTime(new Date());
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { searchQuery, setSearchQuery, clearSearch } = useSearch();
  const isReservationsPage = pathname === '/manage/reservations';

  const [reservationsCount, setReservationsCount] = useState<number>(0);
  const [paymentsCount, setPaymentsCount] = useState<number>(0);

  useEffect(() => {
    if (!user) return;

    let isCancelled = false;

    async function fetchBadgeCounts() {
      try {
        const [resRes, payRes] = await Promise.allSettled([
          fetch('/api/admin/reservations?filter=awaiting_proof', { cache: 'no-store' }),
          fetch('/api/admin/payments/reviews', { cache: 'no-store' }),
        ]);

        if (resRes.status === 'fulfilled' && resRes.value.ok) {
          const resData = await resRes.value.json();
          if (!isCancelled) {
            const count = typeof resData.total === 'number' ? resData.total : (Array.isArray(resData.reservations) ? resData.reservations.length : 0);
            setReservationsCount(count);
          }
        }

        if (payRes.status === 'fulfilled' && payRes.value.ok) {
          const payData = await payRes.value.json();
          if (!isCancelled) {
            const count = Array.isArray(payData.queue) ? payData.queue.length : 0;
            setPaymentsCount(count);
          }
        }
      } catch {
        // Silently ignore badge count fetch errors
      }
    }

    fetchBadgeCounts();
    const interval = setInterval(fetchBadgeCounts, 15000);
    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [user, pathname]);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) {
      router.push('/manage/login');
    }
  }, [user, loading, router]);

  if (loading || !user || user.role !== 'admin') {
    return null; // loading or redirecting
  }

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);

  const navItems = [
    { id: '/manage', label: 'Dashboard', iconType: 'dashboard' },
    { id: '/manage/reservations', label: 'Reservations', iconType: 'reservations', badge: reservationsCount > 0 ? reservationsCount : undefined },
    { id: '/manage/workspace-map', label: 'Workspace Map', iconType: 'map' },
    { id: '/manage/payments', label: 'Payments', iconType: 'payments', badge: paymentsCount > 0 ? paymentsCount : undefined },
    { id: '/manage/workspaces', label: 'Workspaces', iconType: 'workspaces' },
    { id: '/manage/map', label: 'Map Builder', iconType: 'map' },
    { id: '/manage/staff', label: 'Staff', iconType: 'staff' },
    { id: '/manage/reports', label: 'Reports', iconType: 'reports' },
    { id: '/manage/settings', label: 'Settings', iconType: 'settings' },
  ];

  const getIcon = (type: string, isActive: boolean) => {
    // Return the specific SVG/HTML structures from the prototype for each icon
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
      case 'payments':
        return <div style={{ width: '15px', height: '15px', border: `2.5px solid ${color}`, borderRadius: '50%', flexShrink: 0 }}></div>;
      case 'workspaces':
        return (
          <div style={{ width: '15px', height: '15px', display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: '2px', flexShrink: 0 }}>
            <div style={{ border: `2px solid ${color}`, borderRadius: '2px' }}></div><div style={{ border: `2px solid ${color}`, borderRadius: '2px' }}></div>
            <div style={{ border: `2px solid ${color}`, borderRadius: '2px' }}></div><div style={{ background: color, borderRadius: '2px' }}></div>
          </div>
        );
      case 'map':
        return (
          <div style={{ width: '15px', height: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <div style={{ width: '11px', height: '11px', border: `2.5px solid ${color}`, transform: 'rotate(45deg)', borderRadius: '2px' }}></div>
          </div>
        );
      case 'staff':
        return (
          <div style={{ width: '15px', height: '15px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
            <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: color }}></div>
            <div style={{ width: '13px', height: '5px', borderRadius: '9999px 9999px 3px 3px', background: color, opacity: isActive ? 1 : 0.6 }}></div>
          </div>
        );
      case 'reports':
        return (
          <div style={{ width: '15px', height: '15px', display: 'flex', alignItems: 'flex-end', gap: '2.5px', flexShrink: 0 }}>
            <div style={{ flex: 1, height: '6px', background: color, borderRadius: '2px', opacity: isActive ? 1 : 0.5 }}></div>
            <div style={{ flex: 1, height: '11px', background: color, borderRadius: '2px', opacity: isActive ? 1 : 0.75 }}></div>
            <div style={{ flex: 1, height: '15px', background: color, borderRadius: '2px' }}></div>
          </div>
        );
      case 'settings':
        return (
          <div style={{ width: '15px', height: '15px', border: `2.5px solid ${color}`, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: color }}></div>
          </div>
        );
      default:
        return null;
    }
  };

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
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,.72)', fontFamily: 'var(--da-font-family)' }}>Management Portal</div>
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
            const isActive = pathname === item.id || (item.id !== '/manage' && pathname?.startsWith(item.id));
            const navStyle = isActive ? { background: 'var(--da-brand-accent)', color: 'var(--da-brand-dark)' } : { color: 'rgba(255,255,255,.85)' };
            
            return (
              <React.Fragment key={item.id}>
                {sidebarOpen && (idx === 1 || idx === 4 || idx === 6) && (
                  <div style={{ fontSize: '10px', fontWeight: 800, color: 'rgba(255,255,255,.55)', letterSpacing: '.09em', padding: '16px 12px 6px', fontFamily: 'var(--da-font-family)', whiteSpace: 'nowrap' }}>
                    {idx === 1 ? 'OPERATIONS' : idx === 4 ? 'SPACE' : 'ORGANIZATION'}
                  </div>
                )}
                <div 
                  onClick={() => { router.push(item.id); setMobileMenuOpen(false); }} 
                  title={item.label} 
                  style={{ display: 'flex', alignItems: 'center', justifyContent: sidebarOpen ? 'flex-start' : 'center', gap: sidebarOpen ? '11px' : '0', padding: sidebarOpen ? '10px 12px' : '10px 0', borderRadius: '10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'var(--da-font-family)', ...navStyle }}
                >
                  {getIcon(item.iconType, isActive)}
                  {sidebarOpen && <span>{item.label}</span>}
                  {sidebarOpen && typeof item.badge === 'number' && item.badge > 0 && (
                    <span style={{ marginLeft: 'auto', fontSize: '10px', fontWeight: 800, background: '#FFF0CC', color: 'var(--da-brand-dark)', borderRadius: '9999px', whiteSpace: 'nowrap', padding: '2px 7px' }}>
                      {item.badge}
                    </span>
                  )}
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
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={clearSearch}
                    aria-label="Clear search"
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--da-text-secondary)', fontSize: '12px', padding: '0 4px', lineHeight: 1 }}
                  >
                    ✕
                  </button>
                ) : (
                  <span className="mobile-hide" style={{ fontSize: '10px', fontWeight: 700, color: 'var(--da-text-secondary)', background: '#fff', border: '1px solid var(--da-border)', borderRadius: '5px', padding: '2px 6px', fontFamily: 'var(--da-font-family)' }}>⌘K</span>
                )}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div className="mobile-hide" style={{ display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid var(--da-border)', borderRadius: '10px', padding: '7px 12px', fontSize: '12px', fontWeight: 600, color: 'var(--da-text-primary)', fontFamily: 'var(--da-font-family)' }}>
              <div style={{ width: '12px', height: '12px', border: '2px solid var(--da-text-secondary)', borderRadius: '3px' }}></div>
              {currentTime ? `${currentTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ${currentTime.toLocaleTimeString('en-US', { hour12: false })}` : 'Loading...'}
            </div>
            <NotificationCenter />
            <div onClick={logout} style={{ display: 'flex', alignItems: 'center', gap: '9px', paddingLeft: '14px', borderLeft: '1px solid var(--da-border)', cursor: 'pointer' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--da-brand-dark)', color: 'var(--da-brand-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 800 }}>
                {user.name?.[0] || 'A'}
              </div>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', lineHeight: 1.2 }}>{user.name}</div>
                <div style={{ fontSize: '10px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)', textTransform: 'capitalize' }}>{user.role}</div>
              </div>
            </div>
          </div>
        </div>

        {/* PAGE CONTENT */}
        {children}
      </div>
    </div>
  );
}

export default function ManageLayout({ children }: { children: React.ReactNode }) {
  // Wait, if it's the login route, we don't want the shell!
  // But Next.js App Router layouts apply to all children. 
  // We can check pathname, but layout doesn't re-render fully.
  // Actually, we can just render AdminShell and let it handle the auth,
  // but for login, we should probably bypass it.
  
  const pathname = usePathname();
  const isPublicAuthRoute = pathname === '/manage/login' || pathname === '/manage/setup' || pathname?.startsWith('/manage/auth');

  return (
    <AuthProvider>
      <SearchProvider>
        {isPublicAuthRoute ? children : <AdminShell>{children}</AdminShell>}
      </SearchProvider>
    </AuthProvider>
  );
}
