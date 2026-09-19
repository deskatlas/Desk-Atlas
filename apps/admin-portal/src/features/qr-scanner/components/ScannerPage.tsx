"use client";

import React, { useEffect, useRef, useState, useCallback } from 'react';
import jsQR from 'jsqr';
import { useBookingLookup } from '../hooks/useBookingLookup';
import { useCheckInActions, EarlyCheckInModal, isEarlyCheckInError } from '@/features/check-in';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';

interface VideoDeviceOption {
  deviceId: string;
  label: string;
}

function checkIsMobileOrTablet(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const isIPadOS = /Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
  return isMobileUA || isIPadOS;
}

export function ScannerPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scanning, setScanning] = useState(true);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [showEarlyModal, setShowEarlyModal] = useState(false);
  const [isMobileOrTablet, setIsMobileOrTablet] = useState<boolean>(() => checkIsMobileOrTablet());
  const [cameraFacingMode, setCameraFacingMode] = useState<'environment' | 'user'>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('desk_atlas_admin_camera_facing') || localStorage.getItem('desk_atlas_staff_camera_facing');
        if (saved === 'user' || saved === 'environment') return saved;
      } catch {}
    }
    return 'environment';
  });
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      try {
        return localStorage.getItem('desk_atlas_admin_camera_device_id') || localStorage.getItem('desk_atlas_staff_camera_device_id') || '';
      } catch {}
    }
    return '';
  });
  const [videoDevices, setVideoDevices] = useState<VideoDeviceOption[]>([]);
  const [cameraError, setCameraError] = useState<string | null>(null);
  
  const { lookupToken, result, loading: lookupLoading, error: lookupError, clear } = useBookingLookup();
  const { checkIn, checkOut, loading: actionLoading, error: actionError, clearError } = useCheckInActions();
  const router = useRouter();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsMobileOrTablet(checkIsMobileOrTablet());
    }
  }, []);

  const stopStream = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  }, [stream]);

  const handleCameraChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newMode = e.target.value as 'environment' | 'user';
    stopStream();
    setCameraFacingMode(newMode);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('desk_atlas_admin_camera_facing', newMode);
      } catch {}
    }
  };

  const handleDeviceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newDeviceId = e.target.value;
    stopStream();
    setSelectedDeviceId(newDeviceId);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('desk_atlas_admin_camera_device_id', newDeviceId);
      } catch {}
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) return;
    const onDeviceChange = async () => {
      if (!isMobileOrTablet && navigator.mediaDevices?.enumerateDevices) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoInputs = devices
            .filter(d => d.kind === 'videoinput')
            .map((d, index) => ({
              deviceId: d.deviceId,
              label: d.label || `Camera ${index + 1}`
            }));
          setVideoDevices(videoInputs);
        } catch {}
      }
    };

    navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
    };
  }, [isMobileOrTablet]);

  useEffect(() => {
    if (!scanning) return;

    let requestAnimationFrameId: number;
    let localStream: MediaStream | null = null;
    let isMounted = true;

    const startVideo = async () => {
      try {
        setCameraError(null);
        if (isMobileOrTablet) {
          localStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: cameraFacingMode } });
        } else {
          const constraints: MediaStreamConstraints = selectedDeviceId
            ? { video: { deviceId: { exact: selectedDeviceId } } }
            : { video: true };
          try {
            localStream = await navigator.mediaDevices.getUserMedia(constraints);
          } catch {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true });
          }
        }

        if (!isMounted) {
          localStream.getTracks().forEach(t => t.stop());
          return;
        }
        setStream(localStream);

        // For laptop/pc, enumerate devices after permission is granted to get device labels
        if (!isMobileOrTablet && navigator.mediaDevices?.enumerateDevices) {
          try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoInputs = devices
              .filter(d => d.kind === 'videoinput')
              .map((d, index) => ({
                deviceId: d.deviceId,
                label: d.label || `Camera ${index + 1}`
              }));
            setVideoDevices(videoInputs);

            const activeDeviceId = localStream.getVideoTracks()[0]?.getSettings()?.deviceId;
            if (activeDeviceId && (!selectedDeviceId || !videoInputs.some(v => v.deviceId === selectedDeviceId))) {
              setSelectedDeviceId(activeDeviceId);
              try {
                localStorage.setItem('desk_atlas_admin_camera_device_id', activeDeviceId);
              } catch {}
            }
          } catch (enumErr) {
            console.warn("Could not enumerate video devices:", enumErr);
          }
        }

        if (videoRef.current) {
          videoRef.current.srcObject = localStream;
          videoRef.current.setAttribute("playsinline", "true"); // required to tell iOS safari we don't want fullscreen
          videoRef.current.play().catch(() => {});
          requestAnimationFrameId = requestAnimationFrame(tick);
        }
      } catch (err) {
        if (isMounted) {
          console.error("Error accessing camera:", err);
          setCameraError("Unable to access the selected camera. Please check permissions or select another camera.");
        }
      }
    };

    const tick = () => {
      if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
        if (canvasRef.current) {
          const canvas = canvasRef.current;
          canvas.height = videoRef.current.videoHeight;
          canvas.width = videoRef.current.videoWidth;
          const context = canvas.getContext("2d");
          if (context) {
            context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: "dontInvert",
            });
            
            if (code) {
              handleScan(code.data);
              return; // Stop ticking if found
            }
          }
        }
      }
      if (scanning && isMounted) {
        requestAnimationFrameId = requestAnimationFrame(tick);
      }
    };

    startVideo();

    return () => {
      isMounted = false;
      if (requestAnimationFrameId) cancelAnimationFrame(requestAnimationFrameId);
      if (localStream) localStream.getTracks().forEach(t => t.stop());
    };
  }, [scanning, cameraFacingMode, selectedDeviceId, isMobileOrTablet]);

  const handleScan = async (data: string) => {
    setScanning(false);
    stopStream();
    try {
      await lookupToken(data);
    } catch (e) {
      // error handled in hook
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    setScanning(false);
    stopStream();
    try {
      await lookupToken(manualCode);
    } catch (e) {
      // error handled in hook
    }
  };

  const handleCheckIn = async (id: string) => {
    try {
      await checkIn(id);
      router.push(`/manage/reservations/${id}`);
    } catch (e: any) {
      if (isEarlyCheckInError(e)) {
        setShowEarlyModal(true);
        clearError();
      }
    }
  };

  const handleCheckOut = async (id: string) => {
    try {
      await checkOut(id);
      router.push(`/manage/reservations/${id}`);
    } catch (e) {}
  };

  const resumeScanning = () => {
    clear();
    setManualCode('');
    setShowManualInput(false);
    setScanning(true);
  };

  const formatRemaining = (seconds: number) => {
    if (seconds <= 0) return '0 min';
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins} min`;
  };

  const getStatusBadgeStyle = (accessState: string) => {
    switch (accessState) {
      case 'ACTIVE':
        return { background: '#D1FAE5', color: '#065F46', border: '1px solid #A7F3D0' };
      case 'NOT_ACTIVE':
        return { background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A' };
      case 'EXPIRED':
        return { background: '#F3F4F6', color: '#4B5563', border: '1px solid #E5E7EB' };
      case 'INVALID':
      default:
        return { background: '#FEE2E2', color: '#991B1B', border: '1px solid #FECACA' };
    }
  };

  const getStatusLabel = (accessState: string) => {
    switch (accessState) {
      case 'ACTIVE':
        return 'ACTIVE BOOKING';
      case 'NOT_ACTIVE':
        return 'TOO EARLY / NOT ACTIVE';
      case 'EXPIRED':
        return 'EXPIRED';
      case 'INVALID':
      default:
        return 'INVALID / UNCONFIRMED';
    }
  };

  return (
    <main style={{ padding: '26px 28px 40px', maxWidth: '800px', margin: '0 auto', width: '100%' }}>
      <div style={{ marginBottom: '22px' }}>
        <h1 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 3px', letterSpacing: '-0.02em' }}>QR Scanner</h1>
        <div style={{ fontSize: '13px', color: 'var(--da-text-secondary)', fontFamily: "'Inter', sans-serif" }}>Scan guest booking QR codes for check-in and re-entry verification</div>
      </div>

      <div style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '12px', overflow: 'hidden' }}>
        
        {scanning ? (
          <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: '400px', aspectRatio: '1/1', background: '#000', borderRadius: '16px', overflow: 'hidden' }}>
              <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
              <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <div style={{ width: '200px', height: '200px', border: '2px solid var(--da-accent)', borderRadius: '12px', boxShadow: '0 0 0 4000px rgba(0,0,0,0.4)' }}></div>
              </div>
            </div>
            <div style={{ marginTop: '16px', fontSize: '14px', color: 'var(--da-text-secondary)' }}>Point the camera at the booking QR</div>
            
            <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label htmlFor="admin-camera-select" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--da-text-secondary)' }}>
                Camera:
              </label>
              {isMobileOrTablet ? (
                <select
                  id="admin-camera-select"
                  value={cameraFacingMode}
                  onChange={handleCameraChange}
                  style={{
                    borderRadius: '8px',
                    border: '1px solid var(--da-border)',
                    padding: '6px 12px',
                    fontSize: '13px',
                    background: '#fff',
                    color: 'var(--da-brand-dark)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    outline: 'none',
                  }}
                >
                  <option value="environment">Back Camera (Rear)</option>
                  <option value="user">Front Camera (Selfie / Desk)</option>
                </select>
              ) : (
                <select
                  id="admin-camera-select"
                  value={selectedDeviceId}
                  onChange={handleDeviceChange}
                  style={{
                    borderRadius: '8px',
                    border: '1px solid var(--da-border)',
                    padding: '6px 12px',
                    fontSize: '13px',
                    background: '#fff',
                    color: 'var(--da-brand-dark)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    outline: 'none',
                    maxWidth: '280px',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {videoDevices.length > 0 ? (
                    videoDevices.map((dev, idx) => (
                      <option key={dev.deviceId || idx} value={dev.deviceId}>
                        {dev.label || `Camera ${idx + 1}`}
                      </option>
                    ))
                  ) : (
                    <option value="">Default Camera</option>
                  )}
                </select>
              )}
            </div>

            {cameraError && (
              <div style={{ marginTop: '12px', padding: '8px 12px', background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: '8px', color: '#991B1B', fontSize: '12px', maxWidth: '400px', textAlign: 'center' }}>
                {cameraError}
              </div>
            )}

            <div style={{ marginTop: '20px', width: '100%', maxWidth: '400px' }}>
              {!showManualInput ? (
                <button
                  type="button"
                  onClick={() => setShowManualInput(true)}
                  style={{ width: '100%', padding: '10px', background: 'transparent', border: '1px dashed var(--da-border)', borderRadius: '8px', color: 'var(--da-text-secondary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                >
                  Enter Reference Code or ID Manually
                </button>
              ) : (
                <form onSubmit={handleManualSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--da-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Reference Code or Reservation ID
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      placeholder="e.g. DA-2026-01234 or Reservation ID"
                      value={manualCode}
                      onChange={(e) => setManualCode(e.target.value)}
                      style={{ flex: 1, padding: '10px 12px', border: '1px solid var(--da-border)', borderRadius: '8px', fontSize: '13px' }}
                      autoFocus
                    />
                    <button
                      type="submit"
                      disabled={!manualCode.trim()}
                      style={{ padding: '10px 18px', background: 'var(--da-brand-dark)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: manualCode.trim() ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' }}
                    >
                      Check In
                    </button>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setShowManualInput(false);
                        setManualCode('');
                      }}
                      style={{ background: 'none', border: 'none', color: 'var(--da-text-secondary)', fontSize: '12px', cursor: 'pointer', padding: '2px 0' }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        ) : (
          <div style={{ padding: '24px' }}>
            {lookupLoading && (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--da-brand-dark)', marginBottom: '8px' }}>Looking up booking access...</div>
                <div style={{ fontSize: '13px', color: 'var(--da-text-secondary)' }}>Verifying server-authoritative token and booking window</div>
              </div>
            )}
            
            {lookupError && (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <div style={{ color: 'var(--da-danger)', fontSize: '16px', fontWeight: 700, marginBottom: '8px' }}>Scan Lookup Failed</div>
                <div style={{ color: 'var(--da-text-secondary)', fontSize: '13px', marginBottom: '20px', maxWidth: '400px', margin: '0 auto 20px' }}>
                  {lookupError}
                </div>
                <button onClick={resumeScanning} style={{ padding: '10px 24px', background: 'var(--da-brand-dark)', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>Scan Again</button>
              </div>
            )}

            {result && !lookupLoading && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <div>
                    <h2 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: 0 }}>Scan Result</h2>
                    <div style={{ fontSize: '12px', color: 'var(--da-text-secondary)', marginTop: '2px' }}>
                      Ref: {result.referenceCode}
                    </div>
                  </div>
                  <div style={{ padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 700, ...getStatusBadgeStyle(result.accessState) }}>
                    {getStatusLabel(result.accessState)}
                  </div>
                </div>

                {/* Status Notice if not active */}
                {result.accessState === 'NOT_ACTIVE' && (
                  <div style={{ padding: '12px 16px', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: '8px', color: '#92400E', fontSize: '13px', fontWeight: 600, marginBottom: '18px' }}>
                    Too Early: Booking starts at {format(new Date(result.bookingStartAt), 'h:mm a')}. Access is not yet authorized.
                  </div>
                )}
                {result.accessState === 'EXPIRED' && (
                  <div style={{ padding: '12px 16px', background: '#F3F4F6', border: '1px solid #E5E7EB', borderRadius: '8px', color: '#4B5563', fontSize: '13px', fontWeight: 600, marginBottom: '18px' }}>
                    Expired: Booking ended at {format(new Date(result.bookingEndAt), 'h:mm a')}. Access is no longer authorized.
                  </div>
                )}
                {result.accessState === 'INVALID' && (
                  <div style={{ padding: '12px 16px', background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: '8px', color: '#991B1B', fontSize: '13px', fontWeight: 600, marginBottom: '18px' }}>
                    {result.reservationStatus === 'PENDING_PAYMENT' || result.reservationStatus === 'PAYMENT_UNDER_REVIEW' || result.reservationStatus === 'PENDING_COUNTER_CONFIRMATION'
                      ? `Unconfirmed: Reservation payment is ${result.reservationStatus.replace(/_/g, ' ').toLowerCase()}. Entry cannot be granted until confirmed.`
                      : 'Invalid: Reservation is cancelled or invalid. Entry cannot be granted.'}
                  </div>
                )}

                {/* Initial Check-In notice */}
                {result.accessState === 'ACTIVE' && !result.reentry && result.checkInState === 'CHECKED_IN' && (
                  <div style={{ padding: '12px 16px', background: '#D1FAE5', border: '1px solid #A7F3D0', borderRadius: '8px', color: '#065F46', fontSize: '13px', fontWeight: 600, marginBottom: '18px' }}>
                    Active Guest: Guest successfully checked in. Entry authorized during active window.
                  </div>
                )}

                {/* Active Re-entry notice */}
                {result.accessState === 'ACTIVE' && result.reentry && (
                  <div style={{ padding: '12px 16px', background: '#E0F2FE', border: '1px solid #BAE6FD', borderRadius: '8px', color: '#0369A1', fontSize: '13px', fontWeight: 600, marginBottom: '18px' }}>
                    Active Guest (Re-entry): Guest is currently checked in. Re-entry authorized during active window.
                  </div>
                )}

                <div style={{ background: 'var(--da-canvas)', padding: '20px', borderRadius: '8px', marginBottom: '24px' }}>
                  {/* Customer section */}
                  <div style={{ borderBottom: '1px solid var(--da-border)', paddingBottom: '14px', marginBottom: '14px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Customer Details</div>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--da-brand-dark)' }}>{result.customerName}</div>
                    {result.customerEmail && (
                      <div style={{ fontSize: '13px', color: 'var(--da-text-secondary)', marginTop: '2px' }}>{result.customerEmail}</div>
                    )}
                  </div>

                  {/* Spot & Time Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Assigned Spot</div>
                      <div style={{ fontSize: '15px', color: 'var(--da-brand-dark)', fontWeight: 600 }}>{result.workspaceDisplayName}</div>
                      <div style={{ fontSize: '12px', color: 'var(--da-text-secondary)', marginTop: '2px' }}>
                        {result.workspaceTemplateName} • {result.floorName}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Booking Schedule</div>
                      <div style={{ fontSize: '15px', color: 'var(--da-brand-dark)', fontWeight: 600 }}>
                        {format(new Date(result.bookingStartAt), 'h:mm a')} - {format(new Date(result.bookingEndAt), 'h:mm a')}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--da-text-secondary)', marginTop: '2px' }}>
                        {format(new Date(result.bookingStartAt), 'MMM d, yyyy')}
                        {result.accessState === 'ACTIVE' && ` (${formatRemaining(result.timeRemainingSeconds)} remaining)`}
                      </div>
                    </div>
                  </div>
                </div>

                {(() => {
                  const displayActionError = isEarlyCheckInError(actionError) ? null : actionError;
                  return displayActionError ? (
                    <div style={{ color: 'var(--da-danger)', fontSize: '13px', marginBottom: '16px', background: '#FEE2E2', padding: '12px', borderRadius: '6px' }}>
                      {displayActionError}
                    </div>
                  ) : null;
                })()}

                <div style={{ display: 'flex', gap: '12px' }}>
                  {result.checkInState !== 'CHECKED_IN' && (result.reservationStatus === 'CONFIRMED' || result.accessState === 'ACTIVE' || result.accessState === 'NOT_ACTIVE') && (
                    <button 
                      onClick={() => handleCheckIn(result.reservationId)}
                      disabled={actionLoading}
                      style={{ flex: 1, padding: '12px', background: 'var(--da-brand-dark)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: actionLoading ? 'not-allowed' : 'pointer' }}
                    >
                      {actionLoading ? 'Processing...' : 'Check In'}
                    </button>
                  )}
                  {result.accessState === 'ACTIVE' && result.checkInState === 'CHECKED_IN' && (
                    <button 
                      onClick={() => handleCheckOut(result.reservationId)}
                      disabled={actionLoading}
                      style={{ flex: 1, padding: '12px', background: '#fff', color: 'var(--da-danger)', border: '1px solid var(--da-danger)', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: actionLoading ? 'not-allowed' : 'pointer' }}
                    >
                      {actionLoading ? 'Processing...' : 'Check Out'}
                    </button>
                  )}
                  <button 
                    onClick={resumeScanning}
                    disabled={actionLoading}
                    style={{ flex: 1, padding: '12px', background: 'var(--da-canvas)', color: 'var(--da-brand-dark)', border: '1px solid var(--da-border)', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: actionLoading ? 'not-allowed' : 'pointer' }}
                  >
                    Scan Another
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {result && (
        <EarlyCheckInModal
          isOpen={showEarlyModal}
          onClose={() => {
            setShowEarlyModal(false);
            clearError();
          }}
          customerName={result.customerName}
          referenceCode={result.referenceCode}
          workspaceName={result.workspaceDisplayName || result.workspaceTemplateName}
          bookingStartAt={result.bookingStartAt}
          bookingEndAt={result.bookingEndAt}
        />
      )}
    </main>
  );
}
