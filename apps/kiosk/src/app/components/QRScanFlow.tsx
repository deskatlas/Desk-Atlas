import { useState, useEffect } from 'react';
import { ArrowLeft, Camera, CheckCircle, Scan, AlertCircle, Clock, LogOut, RotateCcw } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { Desk } from './WorkspaceMap';

interface QRScanFlowProps {
  onBack: () => void;
  allDesks: Desk[];
  onSwitchToReferenceCode?: () => void;
}

interface ScannedBooking {
  deskId: string;
  deskName: string;
  bookingId?: string;
  reservationId?: string;
  userName: string;
  rentType: 'hourly' | 'day';
  hours?: number;
  total: number;
  date?: string;
  timeSlot?: string;
  duration?: string;
  alternatives?: string[];
  checkedIn?: boolean;
  checkedOut?: boolean;
  temporaryCheckout?: boolean;
  companionNames?: string[];
}

export function QRScanFlow({ onBack, allDesks, onSwitchToReferenceCode }: QRScanFlowProps) {
  const [scannedData, setScannedData] = useState<ScannedBooking | null>(null);
  const [isScanning, setIsScanning] = useState(true);

  // Simulate QR code detection after 3 seconds for demo purposes
  useEffect(() => {
    if (isScanning) {
      const timer = setTimeout(() => {
        // Simulate different scenarios based on random selection
        const scenarios = [
          // Reservation ready for check-in (on time)
          {
            deskId: 'A1',
            deskName: 'A1',
            reservationId: `RES${Date.now()}`,
            userName: 'John Doe',
            date: '2026-05-04',
            timeSlot: '10:00',
            duration: '4',
            rentType: 'hourly' as const,
            total: 20,
            alternatives: ['A2', 'A3'],
            companionNames: ['Maria Clara', 'Crisostomo Ibarra'],
            checkedIn: false,
            checkedOut: false,
            temporaryCheckout: false
          },
          // Early check-in attempt (scheduled for later)
          {
            deskId: 'A1',
            deskName: 'A1',
            reservationId: `RES${Date.now()}`,
            userName: 'Jane Smith',
            date: '2026-05-04',
            timeSlot: '16:00',
            duration: '8',
            rentType: 'hourly' as const,
            total: 40,
            alternatives: ['A2', 'A3'],
            checkedIn: false,
            checkedOut: false
          },
          // Already checked in
          {
            deskId: 'A1',
            deskName: 'A1',
            bookingId: `BK${Date.now()}`,
            userName: 'Sarah Wilson',
            date: '2026-05-04',
            timeSlot: '09:00',
            duration: '4',
            rentType: 'hourly' as const,
            total: 20,
            checkedIn: true,
            checkedOut: false,
            temporaryCheckout: false
          },
          // Temporary checkout
          {
            deskId: 'B5',
            deskName: 'B5',
            bookingId: `BK${Date.now()}`,
            userName: 'Bob Johnson',
            date: '2026-05-04',
            timeSlot: '10:00',
            duration: '6',
            rentType: 'hourly' as const,
            total: 36,
            checkedIn: true,
            checkedOut: false,
            temporaryCheckout: true
          }
        ];

        // Use the first scenario for consistency - ready for check-in
        setScannedData(scenarios[0]);
        setIsScanning(false);
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [isScanning]);

  const handleCheckIn = () => {
    if (scannedData?.temporaryCheckout) {
      // Re-check-in from temporary checkout
      setScannedData({ ...scannedData, temporaryCheckout: false });
      alert('Welcome back! You have been re-checked-in.');
    } else {
      // First time check-in - validate timing
      if (!canCheckIn()) {
        return; // Validation message already shown
      }
      setScannedData({ ...scannedData!, checkedIn: true });
      alert('Check-in successful! Your workspace is ready.');
    }
  };

  // Check if user can check in based on scheduled time
  const canCheckIn = (): boolean => {
    if (!scannedData?.date || !scannedData?.timeSlot) {
      return true; // No schedule restrictions
    }

    const scheduledDate = new Date(scannedData.date);
    const [hours, minutes] = scannedData.timeSlot.split(':').map(Number);
    scheduledDate.setHours(hours, minutes, 0, 0);

    const now = new Date('2026-05-04T10:00:00'); // Current time in demo

    // Allow check-in up to 15 minutes before scheduled time
    const gracePeriodMinutes = 15;
    const earliestCheckIn = new Date(scheduledDate.getTime() - gracePeriodMinutes * 60 * 1000);

    if (now < earliestCheckIn) {
      const hoursUntil = Math.floor((earliestCheckIn.getTime() - now.getTime()) / (1000 * 60 * 60));
      const minutesUntil = Math.floor(((earliestCheckIn.getTime() - now.getTime()) % (1000 * 60 * 60)) / (1000 * 60));

      alert(
        `Early Check-In Not Available\n\n` +
        `Your reservation is scheduled for:\n${scannedData.date} at ${scannedData.timeSlot}\n\n` +
        `You can check in starting at:\n${earliestCheckIn.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}\n\n` +
        `Time remaining: ${hoursUntil}h ${minutesUntil}m\n\n` +
        `Please return at your scheduled time.`
      );
      return false;
    }

    return true;
  };

  // Get check-in status for UI
  const getCheckInStatus = () => {
    if (!scannedData?.date || !scannedData?.timeSlot) {
      return { canCheckIn: true, message: null };
    }

    const scheduledDate = new Date(scannedData.date);
    const [hours, minutes] = scannedData.timeSlot.split(':').map(Number);
    scheduledDate.setHours(hours, minutes, 0, 0);

    const now = new Date('2026-05-04T10:00:00');
    const gracePeriodMinutes = 15;
    const earliestCheckIn = new Date(scheduledDate.getTime() - gracePeriodMinutes * 60 * 1000);

    if (now < earliestCheckIn) {
      const hoursUntil = Math.floor((earliestCheckIn.getTime() - now.getTime()) / (1000 * 60 * 60));
      const minutesUntil = Math.floor(((earliestCheckIn.getTime() - now.getTime()) % (1000 * 60 * 60)) / (1000 * 60));

      return {
        canCheckIn: false,
        message: `Check-in available in ${hoursUntil}h ${minutesUntil}m`,
        details: `Scheduled for ${scannedData.timeSlot}`
      };
    }

    return { canCheckIn: true, message: null };
  };

  const handleCheckout = () => {
    if (confirm('Are you sure you want to check out? This will end your session.')) {
      setScannedData({ ...scannedData!, checkedOut: true, temporaryCheckout: false });
      alert('Checkout successful! Thank you for using our workspace.');
      setTimeout(() => onBack(), 2000);
    }
  };

  const handleTemporaryCheckout = () => {
    if (confirm('Temporary checkout: Your space will remain reserved. Scan your QR code again to re-check-in.')) {
      setScannedData({ ...scannedData!, temporaryCheckout: true });
      alert('Temporary checkout successful! Your space is still reserved. Scan again when you return.');
      setTimeout(() => onBack(), 2000);
    }
  };

  const handleRescan = () => {
    setScannedData(null);
    setIsScanning(true);
  };

  return (
    <div className="fixed inset-0 bg-white z-50 overflow-auto">
      {/* Header */}
      <div className="sticky top-0 bg-white border-b shadow-sm z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={scannedData ? handleRescan : onBack}
            className="p-3 hover:bg-gray-100 rounded-full transition-colors"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="text-2xl font-semibold">Scan QR Code</h1>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-6 py-12">
        {!scannedData ? (
          /* Camera Scanner */
          <div className="space-y-6">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-semibold mb-3">Welcome Back!</h2>
              <p className="text-gray-600 text-lg">Position your QR code in front of the camera</p>
            </div>

            <div className="bg-gray-900 rounded-2xl overflow-hidden aspect-square relative">
              {/* Simulated camera view */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-80 h-80 border-4 border-white rounded-2xl relative">
                  {/* Corner brackets */}
                  <div className="absolute -top-1 -left-1 w-12 h-12 border-t-4 border-l-4 border-blue-500"></div>
                  <div className="absolute -top-1 -right-1 w-12 h-12 border-t-4 border-r-4 border-blue-500"></div>
                  <div className="absolute -bottom-1 -left-1 w-12 h-12 border-b-4 border-l-4 border-blue-500"></div>
                  <div className="absolute -bottom-1 -right-1 w-12 h-12 border-b-4 border-r-4 border-blue-500"></div>

                  {/* Scanning animation */}
                  {isScanning && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Scan className="w-16 h-16 text-blue-500 animate-pulse" />
                    </div>
                  )}
                </div>
              </div>

              {/* Status text */}
              <div className="absolute bottom-12 left-0 right-0 text-center">
                <div className="inline-block bg-black bg-opacity-75 px-6 py-3 rounded-full">
                  <p className="text-white text-lg font-medium">
                    {isScanning ? 'Scanning...' : 'Ready to scan'}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
              <div className="flex items-start gap-3">
                <Camera className="w-6 h-6 text-blue-600 mt-0.5" />
                <div>
                  <p className="font-medium text-blue-900 mb-1">How to scan:</p>
                  <ul className="text-sm text-blue-800 space-y-1">
                    <li>• Hold your QR code steady in front of the camera</li>
                    <li>• Keep the QR code within the white frame</li>
                    <li>• Ensure good lighting for best results</li>
                  </ul>
                </div>
              </div>
            </div>

            <p className="text-center text-gray-500 text-sm">
              The camera will automatically detect and scan your QR code
            </p>

            <div className="pt-6 border-t border-gray-200">
              <p className="text-center text-gray-600 mb-4">Having trouble scanning?</p>
              <button
                onClick={onSwitchToReferenceCode || onBack}
                className="w-full text-white py-4 rounded-xl text-lg font-medium transition-colors"
                style={{ backgroundColor: '#009689' }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
                onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
              >
                Enter Reference Code Instead
              </button>
            </div>
          </div>
        ) : (
          /* Scanned Booking Details */
          <div className="space-y-6">
            {scannedData.temporaryCheckout ? (
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-100 rounded-full mb-4">
                  <RotateCcw className="w-10 h-10 text-blue-600" />
                </div>
                <h2 className="text-3xl font-semibold mb-2">Welcome Back!</h2>
                <p className="text-gray-600 text-lg">Ready to re-check-in, {scannedData.userName}?</p>
                <div className="mt-4 bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <p className="text-sm text-blue-800">
                    You are currently on temporary checkout. Your space is still reserved.
                  </p>
                </div>
              </div>
            ) : scannedData.checkedOut ? (
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-20 h-20 bg-gray-100 rounded-full mb-4">
                  <CheckCircle className="w-10 h-10 text-gray-600" />
                </div>
                <h2 className="text-3xl font-semibold mb-2">Checked Out</h2>
                <p className="text-gray-600 text-lg">Thank you for visiting!</p>
              </div>
            ) : (
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-4">
                  <CheckCircle className="w-10 h-10 text-green-600" />
                </div>
                <h2 className="text-3xl font-semibold mb-2">QR Code Verified!</h2>
                <p className="text-gray-600 text-lg">Welcome, {scannedData.userName}</p>
              </div>
            )}

            <div className="bg-white border-2 border-gray-200 rounded-2xl p-8">
              {/* QR Code Display */}
              <div className="flex justify-center mb-6">
                <QRCodeSVG
                  value={JSON.stringify(scannedData)}
                  size={200}
                  level="H"
                />
              </div>

              {/* Booking Details */}
              <div className="bg-gray-50 rounded-xl p-6 space-y-3">
                <h3 className="font-semibold text-lg mb-3">
                  {scannedData.bookingId ? 'Booking Details' : 'Reservation Details'}
                </h3>

                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <p className="text-gray-600">ID:</p>
                  <p className="font-medium text-right">
                    {scannedData.bookingId || scannedData.reservationId}
                  </p>

                  <p className="text-gray-600">Desk:</p>
                  <p className="font-medium text-right">{scannedData.deskName}</p>

                  {scannedData.date && (
                    <>
                      <p className="text-gray-600">Date:</p>
                      <p className="font-medium text-right">{scannedData.date}</p>
                    </>
                  )}

                  {scannedData.timeSlot && (
                    <>
                      <p className="text-gray-600">Time:</p>
                      <p className="font-medium text-right">{scannedData.timeSlot}</p>
                    </>
                  )}

                  <p className="text-gray-600">Type:</p>
                  <p className="font-medium text-right capitalize">
                    {scannedData.rentType === 'day' ? 'Full Day' : `${scannedData.duration || scannedData.hours} Hours`}
                  </p>

                  <p className="text-gray-600">Total:</p>
                  <p className="font-medium text-right">${scannedData.total}</p>
                </div>

                {scannedData.companionNames &&
                  scannedData.companionNames
                    .map((name) => (typeof name === "string" ? name.trim() : ""))
                    .filter((name) => name.length > 0).length > 0 && (() => {
                    const validCompanions = scannedData.companionNames
                      .map((name) => (typeof name === "string" ? name.trim() : ""))
                      .filter((name) => name.length > 0);
                    return (
                      <div className="pt-3 border-t border-gray-200 mt-3">
                        <div className="flex items-center justify-between text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                          <span>Companions ({validCompanions.length})</span>
                          <span className="text-emerald-800 font-semibold">Group Check-In</span>
                        </div>
                        <div className="flex flex-wrap gap-2" data-testid="kiosk-legacy-companion-roster">
                          {validCompanions.map((name, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center px-3 py-1 rounded-full bg-white border border-gray-300 text-sm font-medium text-gray-800"
                              data-testid={`kiosk-legacy-companion-badge-${idx}`}
                            >
                              {name}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
              </div>

              {/* Status Badge */}
              <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-xl text-center">
                <p className="text-green-800 font-medium">
                  {scannedData.bookingId ? '✓ Active Booking' : '✓ Confirmed Reservation'}
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-3">
              {scannedData.temporaryCheckout ? (
                <>
                  <button
                    onClick={handleCheckIn}
                    className="w-full bg-green-600 hover:bg-green-700 text-white py-4 rounded-xl text-lg font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <RotateCcw className="w-5 h-5" />
                    Re-Check-In
                  </button>

                  <button
                    onClick={handleCheckout}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl text-lg font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <LogOut className="w-5 h-5" />
                    Final Checkout
                  </button>
                </>
              ) : scannedData.checkedIn && !scannedData.checkedOut ? (
                <>
                  <button
                    onClick={handleCheckout}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl text-lg font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <LogOut className="w-5 h-5" />
                    Checkout
                  </button>

                  <button
                    onClick={handleTemporaryCheckout}
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white py-4 rounded-xl text-lg font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <Clock className="w-5 h-5" />
                    Temporary Checkout
                  </button>
                </>
              ) : !scannedData.checkedOut ? (
                <>
                  {(() => {
                    const checkInStatus = getCheckInStatus();
                    return (
                      <>
                        {!checkInStatus.canCheckIn && (
                          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-2">
                            <div className="flex items-start gap-3">
                              <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
                              <div className="flex-1">
                                <p className="font-medium text-yellow-900 mb-1">Check-In Not Yet Available</p>
                                <p className="text-sm text-yellow-800">{checkInStatus.message}</p>
                                {checkInStatus.details && (
                                  <p className="text-sm text-yellow-700 mt-1">{checkInStatus.details}</p>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                        <button
                          onClick={handleCheckIn}
                          disabled={!checkInStatus.canCheckIn}
                          className={`w-full py-4 rounded-xl text-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                            checkInStatus.canCheckIn
                              ? 'bg-green-600 hover:bg-green-700 text-white'
                              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          }`}
                        >
                          <CheckCircle className="w-5 h-5" />
                          Check In Now
                        </button>
                      </>
                    );
                  })()}
                </>
              ) : null}

              {/*
                Reschedule and Cancel removed from the kiosk flow - see the
                identical note in ReferenceCodeFlow.tsx. Same review
                finding (Section 7.2), same architecture rule against
                duplicating business logic per frontend.
              */}
              {!scannedData.checkedOut && !scannedData.checkedIn && scannedData.reservationId && (
                <div className="w-full bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-600 text-center">
                  Need to reschedule or cancel? Use the link in your booking confirmation email to manage this reservation online.
                </div>
              )}

              <button
                onClick={onBack}
                className="w-full bg-gray-200 hover:bg-gray-300 text-gray-800 py-4 rounded-xl text-lg font-medium transition-colors"
              >
                Return to Main Screen
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
