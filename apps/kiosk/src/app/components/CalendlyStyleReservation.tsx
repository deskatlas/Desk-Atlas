import { useEffect, useState } from 'react';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Clock, Calendar as CalendarIcon, AlertCircle } from 'lucide-react';
import { WorkspaceMap, type Desk } from './WorkspaceMap';
import { handleNumericKeyDown } from '@deskatlas/ui';
import { QRCodeSVG } from 'qrcode.react';
import { BookingConfirmation } from './BookingConfirmation';
import { UpcomingScheduleView } from './UpcomingScheduleView';
import {
  fetchDateAvailability,
  fetchTimeAvailability,
} from '../lib/availabilityApi';

interface CalendlyStyleReservationProps {
  desk: Desk;
  allDesks: Desk[];
  onBack: () => void;
}

type PaymentMethod = 'cash' | 'card' | 'qr';

interface ReservationData {
  date: string;
  timeSlot: string;
  duration: number;
  customDuration?: number;
  alternativeDesks: string[];
  alternativeDateTime?: {
    date: string;
    timeSlot: string;
  };
  fullName: string;
  email: string;
  privacyConsent: boolean;
  paymentMethod: PaymentMethod;
}

interface SlotInfo {
  time: string;
  isPending: boolean;
}

export function CalendlyStyleReservation({ desk, allDesks, onBack }: CalendlyStyleReservationProps) {
  const [step, setStep] = useState(0);
  const [reservationData, setReservationData] = useState<Partial<ReservationData>>({
    alternativeDesks: []
  });

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [availableSlots, setAvailableSlots] = useState<SlotInfo[]>([]);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [isAlternativeAssigned, setIsAlternativeAssigned] = useState(false);
  const [assignedDesk, setAssignedDesk] = useState(desk.name);
  const [isPendingSlot, setIsPendingSlot] = useState(false);
  const [showPendingWarning, setShowPendingWarning] = useState(false);
  const [alternativeDate, setAlternativeDate] = useState<string | null>(null);
  const [alternativeTimeSlot, setAlternativeTimeSlot] = useState<string | null>(null);
  const [alternativeAvailableSlots, setAlternativeAvailableSlots] = useState<SlotInfo[]>([]);
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);

  // Generate queue number for cash payments
  const queueNumber = `Q${Math.floor(Math.random() * 9000) + 1000}`;
  const dateSelectionDurationMinutes = 60;

  const totalSteps = 7;

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    return { daysInMonth, startingDayOfWeek };
  };

  useEffect(() => {
    if (!desk.workspaceInstanceId) {
      setAvailableDates([]);
      return;
    }

    let isMounted = true;
    const monthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const monthEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);

    fetchDateAvailability({
      workspaceInstanceId: desk.workspaceInstanceId,
      startDate: formatDate(monthStart),
      endDate: formatDate(monthEnd),
      durationMinutes: dateSelectionDurationMinutes,
    })
      .then((result) => {
        if (!isMounted) return;
        setAvailableDates(result.dates.filter((date) => date.isAvailable).map((date) => date.date));
      })
      .catch((error) => {
        console.warn('Unable to load kiosk date availability', error);
        if (isMounted) {
          setAvailableDates([]);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [currentMonth, dateSelectionDurationMinutes, desk.workspaceInstanceId]);

  const handleDateSelect = async (day: number) => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    setSelectedDate(dateString);
    if (!desk.workspaceInstanceId) {
      setAvailableSlots([]);
      return;
    }

    try {
      const result = await fetchTimeAvailability({
        workspaceInstanceId: desk.workspaceInstanceId,
        date: dateString,
        durationMinutes: dateSelectionDurationMinutes,
      });
      setAvailableSlots(result.slots.filter((slot) => slot.isAvailable).map((slot) => ({
        time: slot.startTime,
        isPending: false,
      })));
    } catch (error) {
      console.warn('Unable to load kiosk time availability', error);
      setAvailableSlots([]);
    }
  };

  const handleTimeSlotSelect = (slotInfo: SlotInfo) => {
    setReservationData({ ...reservationData, date: selectedDate!, timeSlot: slotInfo.time });
    setIsPendingSlot(slotInfo.isPending);

    if (slotInfo.isPending) {
      setShowPendingWarning(true);
    }
  };

  const handleDurationSelect = (duration: number | 'custom') => {
    if (duration === 'custom') {
      setReservationData({ ...reservationData, duration: 0 });
    } else {
      setReservationData({ ...reservationData, duration, customDuration: undefined });
      setStep(3);
    }
  };

  const handleCustomDuration = (hours: number) => {
    setReservationData({ ...reservationData, duration: hours, customDuration: hours });
    setStep(3);
  };

  const toggleAlternativeDesk = (deskId: string) => {
    const alternatives = reservationData.alternativeDesks || [];
    if (alternatives.includes(deskId)) {
      setReservationData({
        ...reservationData,
        alternativeDesks: alternatives.filter(id => id !== deskId)
      });
    } else if (alternatives.length < 4) {
      setReservationData({
        ...reservationData,
        alternativeDesks: [...alternatives, deskId]
      });
    }
  };

  const handleUserInfo = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setReservationData({
      ...reservationData,
      fullName: formData.get('fullName') as string,
      email: formData.get('email') as string,
      privacyConsent: formData.get('privacy') === 'on'
    });
    setStep(5);
  };

  const handlePaymentMethod = (method: PaymentMethod) => {
    setReservationData({ ...reservationData, paymentMethod: method });
    if (method === 'cash') {
      setStep(6); // Go to confirmation for cash
    } else {
      setStep(5.5); // Go to payment processing for card/QR
    }
  };

  const handlePaymentProcessing = () => {
    setPaymentProcessing(true);

    // Simulate payment gateway processing (3 seconds)
    setTimeout(() => {
      setPaymentProcessing(false);
      setPaymentConfirmed(true);

      // Show success notification
      setTimeout(() => {
        setStep(6); // Move to confirmation
      }, 2000);
    }, 3000);
  };

  const handlePaymentConfirm = () => {
    // Simulate checking if primary desk was taken by pending payment completion
    // In real app, this would be an API call
    const wasPrimaryTaken = isPendingSlot && Math.random() > 0.5; // 50% chance if pending slot

    if (wasPrimaryTaken && reservationData.alternativeDesks && reservationData.alternativeDesks.length > 0) {
      // Assign alternative desk AND alternative date/time
      const alternativeDeskId = reservationData.alternativeDesks[0];
      const alternativeDesk = allDesks.find(d => d.id === alternativeDeskId);

      setIsAlternativeAssigned(true);
      setAssignedDesk(alternativeDesk?.name || desk.name);

      // Show email notification that primary was taken
      if (isPendingSlot) {
        setTimeout(() => {
          alert(
            `Email Notification Sent\n\n` +
            `To: ${reservationData.fullName} <${reservationData.email}>\n\n` +
            `Subject: Booking Update - Alternative Assigned\n\n` +
            `Your preferred desk "${desk.name}" at ${reservationData.timeSlot} on ${reservationData.date} was confirmed by another user who completed their pending payment.\n\n` +
            `You have been assigned:\n` +
            `Desk: ${alternativeDesk?.name}\n` +
            `Date: ${reservationData.alternativeDateTime?.date || reservationData.date}\n` +
            `Time: ${reservationData.alternativeDateTime?.timeSlot || reservationData.timeSlot}\n\n` +
            `Please check your email for full details.`
          );
        }, 500);
      }
    } else {
      setIsAlternativeAssigned(false);
      setAssignedDesk(desk.name);
    }

    setStep(7);
  };

  const handleAlternativeDateSelect = (day: number) => {
    // Create date in local timezone to avoid UTC conversion issues
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    setAlternativeDate(dateString);
    setAlternativeAvailableSlots([]);
    setAlternativeTimeSlot(null);
  };

  const handleAlternativeTimeSelect = (slotInfo: SlotInfo) => {
    setAlternativeTimeSlot(slotInfo.time);
    setReservationData({
      ...reservationData,
      alternativeDateTime: {
        date: alternativeDate!,
        timeSlot: slotInfo.time
      }
    });
  };

  const calculateTotal = () => {
    const duration = reservationData.customDuration || reservationData.duration || 1;
    // Use day rate for 8+ hours (Full Day Access)
    if (duration >= 8) {
      return desk.dayRate;
    }
    return desk.hourlyRate * duration;
  };

  const { daysInMonth, startingDayOfWeek } = getDaysInMonth(currentMonth);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Filter desks by same zone to keep price range similar
  const availableDesks = allDesks.filter(d =>
    d.id !== desk.id &&
    d.zone === desk.zone && // Same zone for similar pricing
    (d.status === 'available' || d.status === 'pending')
  );

  const qrData = JSON.stringify({
    deskId: desk.id,
    deskName: desk.name,
    reservationId: `RES${Date.now()}`,
    userName: reservationData.fullName,
    date: reservationData.date,
    timeSlot: reservationData.timeSlot,
    duration: reservationData.customDuration || reservationData.duration,
    alternatives: reservationData.alternativeDesks,
    total: calculateTotal()
  });

  return (
    <div className="fixed inset-0 bg-white z-50 overflow-auto">
      {/* Header */}
      <div className="sticky top-0 bg-white border-b shadow-sm z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <button
            onClick={step === 0 ? onBack : () => setStep(step - 1)}
            className="p-3 hover:bg-gray-100 rounded-full transition-colors"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="text-2xl font-semibold">Book Reservation - {desk.name}</h1>
          <div className="text-sm text-gray-600">Step {step + 1} of {totalSteps}</div>
        </div>

        {/* Progress bar */}
        <div className="h-2 bg-gray-200">
          <div
            className="h-full bg-purple-600 transition-all duration-300"
            style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
          />
        </div>
      </div>

      {/* Content */}
      <div className={`${step === 3 ? 'max-w-6xl' : 'max-w-4xl'} mx-auto px-6 py-12`}>
        {/* Step 0: Upcoming Schedule View */}
        {step === 0 && (
          <UpcomingScheduleView
            deskName={desk.name}
            onContinue={() => setStep(1)}
            buttonText="Continue to Select Date & Time"
          />
        )}

        {/* Step 1: Date, Time & Duration - Calendly Style */}
        {step === 1 && (
          <div className="grid md:grid-cols-2 gap-8">
            {/* Left: Date Selection */}
            <div>
              <h2 className="text-2xl font-semibold mb-6">Select Date & Time</h2>

              {/* Calendar */}
              <div className="bg-white border-2 border-gray-200 rounded-xl p-6">
                {/* Month Navigation */}
                <div className="flex items-center justify-between mb-4">
                  <button
                    onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}
                    className="p-2 hover:bg-gray-100 rounded-lg"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <h3 className="font-semibold">
                    {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </h3>
                  <button
                    onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}
                    className="p-2 hover:bg-gray-100 rounded-lg"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>

                {/* Day Headers */}
                <div className="grid grid-cols-7 gap-2 mb-2">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                    <div key={day} className="text-center text-sm font-medium text-gray-600 py-2">
                      {day}
                    </div>
                  ))}
                </div>

                {/* Calendar Days */}
                <div className="grid grid-cols-7 gap-2">
                  {Array.from({ length: startingDayOfWeek }).map((_, i) => (
                    <div key={`empty-${i}`} />
                  ))}
                  {Array.from({ length: daysInMonth }).map((_, i) => {
                    const day = i + 1;
                    const year = currentMonth.getFullYear();
                    const month = currentMonth.getMonth();
                    const dateObj = new Date(year, month, day);
                    // Format as YYYY-MM-DD without UTC conversion (consistent with handleDateSelect)
                    const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const isPast = dateObj < today;
                    const isSelected = selectedDate === dateString;
                    const isUnavailable =
                      Boolean(desk.workspaceInstanceId) && !availableDates.includes(dateString);

                    return (
                      <button
                        key={day}
                        onClick={() => !isPast && !isUnavailable && void handleDateSelect(day)}
                        disabled={isPast || isUnavailable}
                        className={`aspect-square p-2 rounded-lg text-sm font-medium transition-colors ${
                          isPast || isUnavailable
                            ? 'text-gray-300 cursor-not-allowed'
                            : isSelected
                              ? 'bg-purple-600 text-white'
                              : 'hover:bg-purple-50 text-gray-900'
                        }`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right: Time Slots & Duration */}
            <div>
              {selectedDate ? (
                <>
                  <h3 className="text-xl font-semibold mb-4">
                    {(() => {
                      const [year, month, day] = selectedDate.split('-').map(Number);
                      const date = new Date(year, month - 1, day);
                      return date.toLocaleDateString('en-US', {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric'
                      });
                    })()}
                  </h3>

                  {!reservationData.timeSlot ? (
                    /* Time Slot Selection */
                    <div className="space-y-3">
                      <p className="text-gray-600 mb-4">Available time slots:</p>
                      <div className="grid grid-cols-2 gap-3 max-h-96 overflow-y-auto">
                        {availableSlots.map(slotInfo => (
                          <button
                            key={slotInfo.time}
                            onClick={() => handleTimeSlotSelect(slotInfo)}
                            className={`p-4 border-2 rounded-xl font-medium transition-colors ${
                              slotInfo.isPending
                                ? 'border-yellow-300 bg-yellow-50 hover:border-yellow-500'
                                : 'border-gray-300 hover:border-purple-600'
                            }`}
                          >
                            <Clock className="w-4 h-4 inline mr-2" />
                            {slotInfo.time}
                            {slotInfo.isPending && (
                              <span className="block text-xs text-yellow-700 mt-1">⏳ Pending payment</span>
                            )}
                          </button>
                        ))}
                      </div>
                      {availableSlots.length === 0 && (
                        <p className="text-center text-gray-500 py-8">No available slots for this date</p>
                      )}
                    </div>
                  ) : (
                    /* Duration Selection */
                    <div className="space-y-4">
                      {isPendingSlot && showPendingWarning && (
                        <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl p-4 mb-4">
                          <div className="flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
                            <div className="flex-1">
                              <p className="font-semibold text-yellow-900 mb-2">Pending Cash Payment Conflict</p>
                              <p className="text-sm text-yellow-800 mb-2">
                                This time slot has a pending cash payment. If that user completes payment first:
                              </p>
                              <ul className="text-sm text-yellow-800 list-disc list-inside space-y-1">
                                <li>You will be assigned to one of your alternative desk choices</li>
                                <li>You will need to select a new date and time for your booking</li>
                                <li>The system will notify you immediately</li>
                              </ul>
                              <p className="text-sm text-yellow-800 mt-2 font-medium">
                                Please ensure you select alternative desks AND times in the next steps.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className={`rounded-xl p-4 mb-4 ${
                        isPendingSlot ? 'bg-yellow-50 border border-yellow-200' : 'bg-purple-50 border border-purple-200'
                      }`}>
                        <p className={`text-sm ${isPendingSlot ? 'text-yellow-900' : 'text-purple-900'}`}>
                          <CalendarIcon className="w-4 h-4 inline mr-2" />
                          {reservationData.timeSlot}
                          {isPendingSlot && <span className="ml-2 text-xs">⏳ Pending</span>}
                        </p>
                      </div>

                      <p className="text-gray-600 mb-4">Select duration:</p>

                      {reservationData.duration === 0 ? (
                        /* Custom Duration Input */
                        <div className="space-y-4">
                          <input
                            type="number"
                            min="1"
                            max="12"
                            placeholder="Enter hours"
                            className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl text-lg focus:border-purple-600 focus:outline-none"
                            onKeyDown={(e) => {
                              handleNumericKeyDown(e);
                              if (e.key === 'Enter') {
                                const value = parseInt((e.target as HTMLInputElement).value);
                                if (value > 0) handleCustomDuration(value);
                              }
                            }}
                          />
                          <button
                            onClick={(e) => {
                              const input = e.currentTarget.previousElementSibling as HTMLInputElement;
                              const value = parseInt(input.value);
                              if (value > 0) handleCustomDuration(value);
                            }}
                            className="w-full bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-xl font-medium"
                          >
                            Confirm Duration
                          </button>
                          <button
                            onClick={() => setReservationData({ ...reservationData, duration: undefined })}
                            className="w-full text-gray-600 hover:text-gray-800"
                          >
                            Back to presets
                          </button>
                        </div>
                      ) : (
                        /* Preset Durations */
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            {[1, 2, 4, 8].map(hours => (
                              <button
                                key={hours}
                                onClick={() => handleDurationSelect(hours)}
                                className="p-4 border-2 border-gray-300 hover:border-purple-600 rounded-xl transition-colors"
                              >
                                <div className="font-semibold">{hours} {hours === 1 ? 'Hour' : 'Hours'}</div>
                                <div className="text-sm text-purple-600 mt-1">₱{desk.hourlyRate * hours}</div>
                              </button>
                            ))}
                          </div>

                          {/* Full Day Access */}
                          <button
                            onClick={() => handleDurationSelect(8)}
                            className="w-full p-4 border-2 border-purple-500 bg-purple-50 hover:bg-purple-100 rounded-xl transition-colors"
                          >
                            <div className="font-semibold text-lg">Full Day Access</div>
                            <div className="text-sm text-purple-600 mt-1">₱{desk.dayRate}</div>
                          </button>

                          {/* Custom Duration */}
                          <button
                            onClick={() => handleDurationSelect('custom')}
                            className="w-full p-4 border-2 border-dashed border-gray-300 hover:border-purple-600 rounded-xl transition-colors"
                          >
                            <div className="font-semibold">Custom Duration</div>
                            <div className="text-sm text-gray-600 mt-1">Enter hours manually</div>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-center h-64 text-gray-400">
                  <div className="text-center">
                    <CalendarIcon className="w-12 h-12 mx-auto mb-3" />
                    <p>Select a date to see available times</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 3: Alternative Spaces */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-3xl font-semibold mb-2">Select Alternatives</h2>
              <p className="text-gray-600">Choose up to 4 backup spaces from {desk.zone} in case your preferred space becomes unavailable</p>
            </div>

            {isPendingSlot && (
              <div className="bg-red-50 border-2 border-red-300 rounded-xl p-6">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-6 h-6 text-red-600 mt-0.5" />
                  <div>
                    <p className="font-semibold text-red-900 mb-2">⚠️ Pending Payment - Action Required</p>
                    <p className="text-sm text-red-800 mb-3">
                      You selected a time slot with pending cash payment. If that user completes payment first, you will be moved to your alternative selections.
                    </p>
                    <p className="text-sm font-semibold text-red-900 mb-2">
                      You MUST select:
                    </p>
                    <ul className="text-sm text-red-800 list-disc list-inside space-y-1">
                      <li>Alternative desk(s) from the same zone</li>
                      <li>Alternative date and time (in next step)</li>
                    </ul>
                    <p className="text-sm text-red-700 mt-3 italic">
                      📧 You will be notified via email if your primary choice is taken.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {availableDesks.length === 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                <p className="text-sm text-yellow-800">
                  No alternative desks available in {desk.zone}. You can still proceed with your reservation.
                </p>
              </div>
            )}

            <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
              <p className="text-sm">
                <span className="font-medium">Selected: {reservationData.alternativeDesks?.length || 0}/4</span>
              </p>
            </div>

            {/* Interactive Workspace Map - Full Size for Kiosk */}
            <div className="border-2 border-gray-200 rounded-xl p-8 bg-white" style={{ minHeight: '700px', height: '70vh' }}>
              <WorkspaceMap
                desks={allDesks}
                onDeskClick={(clickedDesk) => {
                  if (clickedDesk.id !== desk.id && (clickedDesk.status === 'available' || clickedDesk.status === 'pending')) {
                    toggleAlternativeDesk(clickedDesk.id);
                  }
                }}
                selectedDeskId={desk.id}
                highlightedDeskIds={reservationData.alternativeDesks || []}
                interactiveZone={desk.zone}
              />
            </div>

            <div className="bg-gray-50 border border-gray-300 rounded-xl p-4">
              <p className="text-sm text-gray-700">
                <span className="font-medium">💡 Tip:</span> Click on desks in <span className="font-semibold">{desk.zone}</span> to select alternatives. Other zones are shown for reference only.
              </p>
            </div>

            <button
              onClick={() => isPendingSlot ? setStep(3.5) : setStep(4)}
              disabled={isPendingSlot && reservationData.alternativeDesks?.length === 0}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white py-4 rounded-xl text-lg font-medium transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isPendingSlot && reservationData.alternativeDesks?.length === 0
                ? 'Please select at least 1 alternative'
                : 'Continue'}
            </button>
          </div>
        )}

        {/* Step 3.5: Alternative Date & Time (for pending slots only) */}
        {step === 3.5 && isPendingSlot && (
          <div className="grid md:grid-cols-2 gap-8">
            {/* Left: Alternative Date Selection */}
            <div>
              <h2 className="text-2xl font-semibold mb-6">Select Alternative Date & Time</h2>

              <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-4">
                <p className="text-sm text-orange-800">
                  This will be used if your primary choice gets taken by the pending payment user.
                </p>
              </div>

              {/* Calendar */}
              <div className="bg-white border-2 border-gray-200 rounded-xl p-6">
                {/* Month Navigation */}
                <div className="flex items-center justify-between mb-4">
                  <button
                    onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}
                    className="p-2 hover:bg-gray-100 rounded-lg"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <h3 className="font-semibold">
                    {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </h3>
                  <button
                    onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}
                    className="p-2 hover:bg-gray-100 rounded-lg"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>

                {/* Day Headers */}
                <div className="grid grid-cols-7 gap-2 mb-2">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                    <div key={day} className="text-center text-sm font-medium text-gray-600 py-2">
                      {day}
                    </div>
                  ))}
                </div>

                {/* Calendar Days */}
                <div className="grid grid-cols-7 gap-2">
                  {Array.from({ length: startingDayOfWeek }).map((_, i) => (
                    <div key={`empty-${i}`} />
                  ))}
                  {Array.from({ length: daysInMonth }).map((_, i) => {
                    const day = i + 1;
                    const year = currentMonth.getFullYear();
                    const month = currentMonth.getMonth();
                    const dateObj = new Date(year, month, day);
                    // Format as YYYY-MM-DD without UTC conversion (consistent with handleAlternativeDateSelect)
                    const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const isPast = dateObj < today;
                    const isSelected = alternativeDate === dateString;

                    return (
                      <button
                        key={day}
                        onClick={() => !isPast && handleAlternativeDateSelect(day)}
                        disabled={isPast}
                        className={`aspect-square p-2 rounded-lg text-sm font-medium transition-colors ${
                          isPast
                            ? 'text-gray-300 cursor-not-allowed'
                            : isSelected
                              ? 'bg-orange-600 text-white'
                              : 'hover:bg-orange-50 text-gray-900'
                        }`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right: Alternative Time Slots */}
            <div>
              {alternativeDate ? (
                <>
                  <h3 className="text-xl font-semibold mb-4">
                    {(() => {
                      const [year, month, day] = alternativeDate.split('-').map(Number);
                      const date = new Date(year, month - 1, day);
                      return date.toLocaleDateString('en-US', {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric'
                      });
                    })()}
                  </h3>

                  <p className="text-gray-600 mb-4">Select alternative time slot:</p>
                  <div className="grid grid-cols-2 gap-3 max-h-96 overflow-y-auto">
                    {alternativeAvailableSlots.map(slotInfo => {
                      const isSelected = alternativeTimeSlot === slotInfo.time;
                      return (
                        <button
                          key={slotInfo.time}
                          onClick={() => handleAlternativeTimeSelect(slotInfo)}
                          className={`p-4 border-2 rounded-xl font-medium transition-colors ${
                            isSelected
                              ? 'border-orange-600 bg-orange-50'
                              : slotInfo.isPending
                                ? 'border-yellow-300 bg-yellow-50 hover:border-yellow-500'
                                : 'border-gray-300 hover:border-orange-400'
                          }`}
                        >
                          <Clock className="w-4 h-4 inline mr-2" />
                          {slotInfo.time}
                          {slotInfo.isPending && (
                            <span className="block text-xs text-yellow-700 mt-1">⏳ Pending</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {alternativeAvailableSlots.length === 0 && (
                    <p className="text-center text-gray-500 py-8">No available slots for this date</p>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-center h-64 text-gray-400">
                  <div className="text-center">
                    <CalendarIcon className="w-12 h-12 mx-auto mb-3" />
                    <p>Select an alternative date to see available times</p>
                  </div>
                </div>
              )}

              {alternativeDate && alternativeTimeSlot && (
                <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-4">
                  <p className="text-sm text-green-800">
                    ✓ Alternative selected: {alternativeDate} at {alternativeTimeSlot}
                  </p>
                </div>
              )}

              {alternativeDate && alternativeTimeSlot && (
                <button
                  onClick={() => setStep(4)}
                  className="w-full mt-4 bg-purple-600 hover:bg-purple-700 text-white py-4 rounded-xl text-lg font-medium transition-colors"
                >
                  Continue to User Information
                </button>
              )}
            </div>
          </div>
        )}

        {/* Step 4: User Information */}
        {step === 4 && (
          <form onSubmit={handleUserInfo} className="space-y-6 max-w-2xl mx-auto">
            <h2 className="text-3xl font-semibold mb-8">Your Information</h2>

            <div>
              <label className="block text-lg font-medium mb-2">Full Name</label>
              <input
                type="text"
                name="fullName"
                required
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl text-lg focus:border-purple-600 focus:outline-none"
                placeholder="Enter your full name"
              />
            </div>

            <div>
              <label className="block text-lg font-medium mb-2">Email Address</label>
              <input
                type="email"
                name="email"
                required
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl text-lg focus:border-purple-600 focus:outline-none"
                placeholder="your.email@example.com"
              />
            </div>

            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                name="privacy"
                id="privacy"
                required
                className="w-5 h-5 mt-1"
              />
              <label htmlFor="privacy" className="text-gray-600">
                I consent to the collection and processing of my personal information in accordance with the privacy policy. My data will be used solely for booking management and communication purposes.
              </label>
            </div>

            <button
              type="submit"
              className="w-full bg-purple-600 hover:bg-purple-700 text-white py-4 rounded-xl text-lg font-medium transition-colors"
            >
              Continue
            </button>
          </form>
        )}

        {/* Step 5: Payment Method */}
        {step === 5 && (
          <div className="space-y-6 max-w-2xl mx-auto">
            <h2 className="text-3xl font-semibold mb-8">Payment Method</h2>

            <div className="bg-gray-100 rounded-xl p-6 mb-8">
              <div className="flex justify-between items-center">
                <span className="text-lg">Total Amount</span>
                <span className="text-3xl font-bold">₱{calculateTotal().toFixed(2)}</span>
              </div>
            </div>

            <div className="grid gap-4">
              <button
                onClick={() => handlePaymentMethod('cash')}
                className="border-2 border-gray-300 hover:border-purple-600 rounded-xl p-6 text-left transition-all hover:shadow-lg"
              >
                <h3 className="text-xl font-semibold">Cash</h3>
                <p className="text-gray-600 mt-1">Pay with cash at reception</p>
              </button>

              <button
                onClick={() => handlePaymentMethod('card')}
                className="border-2 border-gray-300 hover:border-purple-600 rounded-xl p-6 text-left transition-all hover:shadow-lg"
              >
                <h3 className="text-xl font-semibold">Card</h3>
                <p className="text-gray-600 mt-1">Credit or debit card payment</p>
              </button>

              <button
                onClick={() => handlePaymentMethod('qr')}
                className="border-2 border-gray-300 hover:border-purple-600 rounded-xl p-6 text-left transition-all hover:shadow-lg"
              >
                <h3 className="text-xl font-semibold">QR Payment</h3>
                <p className="text-gray-600 mt-1">Scan and pay with your mobile wallet</p>
              </button>
            </div>
          </div>
        )}

        {/* Step 5.5: Payment Processing (Card/QR) */}
        {step === 5.5 && (
          <div className="space-y-6 max-w-2xl mx-auto">
            <h2 className="text-3xl font-semibold mb-8">Processing Payment</h2>

            <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 mb-6">
              <div className="flex justify-between items-center">
                <span className="text-lg">Total Amount</span>
                <span className="text-3xl font-bold">₱{calculateTotal().toFixed(2)}</span>
              </div>
            </div>

            {reservationData.paymentMethod === 'card' && !paymentProcessing && !paymentConfirmed && (
              /* Card Terminal Instructions */
              <div className="space-y-6">
                <div className="bg-blue-50 border-2 border-blue-300 rounded-xl p-8">
                  <div className="text-center">
                    <div className="w-24 h-24 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
                      <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                      </svg>
                    </div>
                    <h3 className="text-2xl font-semibold mb-4">Tap Your Card</h3>
                    <p className="text-lg text-gray-700 mb-6">Please tap or insert your card on the payment terminal</p>
                    <div className="flex items-center justify-center gap-2 text-blue-700">
                      <div className="w-3 h-3 bg-blue-600 rounded-full animate-pulse"></div>
                      <p className="text-sm font-medium">Waiting for card...</p>
                    </div>
                  </div>
                </div>

                <button
                  onClick={handlePaymentProcessing}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl text-lg font-medium transition-colors"
                >
                  Simulate Card Tap
                </button>
              </div>
            )}

            {reservationData.paymentMethod === 'qr' && !paymentProcessing && !paymentConfirmed && (
              /* QR Payment Gateway */
              <div className="space-y-6">
                <div className="bg-purple-50 border-2 border-purple-300 rounded-xl p-8">
                  <div className="text-center">
                    <h3 className="text-2xl font-semibold mb-4">Scan to Pay</h3>
                    <p className="text-gray-700 mb-6">Use your mobile wallet app to scan and pay</p>

                    {/* Payment QR Code */}
                    <div className="bg-white p-6 rounded-xl inline-block mb-4">
                      <QRCodeSVG
                        value={JSON.stringify({
                          paymentType: 'QRPh',
                          merchantId: 'COWORK-KIOSK-001',
                          amount: calculateTotal(),
                          currency: 'PHP',
                          reference: `PAY${Date.now()}`
                        })}
                        size={200}
                        level="H"
                      />
                    </div>

                    <p className="text-sm text-gray-600 mb-4">Supported: GCash, PayMaya, QRPh</p>

                    <div className="flex items-center justify-center gap-2 text-purple-700">
                      <div className="w-3 h-3 bg-purple-600 rounded-full animate-pulse"></div>
                      <p className="text-sm font-medium">Waiting for payment...</p>
                    </div>
                  </div>
                </div>

                <button
                  onClick={handlePaymentProcessing}
                  className="w-full bg-purple-600 hover:bg-purple-700 text-white py-4 rounded-xl text-lg font-medium transition-colors"
                >
                  Simulate QR Payment
                </button>
              </div>
            )}

            {paymentProcessing && (
              /* Processing Animation */
              <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl p-12">
                <div className="text-center">
                  <div className="w-20 h-20 border-4 border-yellow-600 border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
                  <h3 className="text-2xl font-semibold mb-2">Processing Payment...</h3>
                  <p className="text-gray-600">Please wait while we confirm your payment</p>
                </div>
              </div>
            )}

            {paymentConfirmed && !paymentProcessing && (
              /* Payment Success */
              <div className="bg-green-50 border-2 border-green-300 rounded-xl p-12">
                <div className="text-center">
                  <div className="w-20 h-20 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Check className="w-12 h-12 text-white" />
                  </div>
                  <h3 className="text-2xl font-semibold text-green-900 mb-2">Payment Confirmed!</h3>
                  <p className="text-green-800 mb-4">₱{calculateTotal().toFixed(2)} paid successfully</p>
                  <p className="text-sm text-green-700">Staff has been notified. Preparing your reservation confirmation...</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 6: Reservation Confirmation Summary */}
        {step === 6 && (
          <div className="space-y-6 max-w-2xl mx-auto">
            <h2 className="text-3xl font-semibold mb-8">
              {reservationData.paymentMethod === 'cash' ? 'Confirm Reservation' : 'Finalizing Your Reservation'}
            </h2>

            {reservationData.paymentMethod !== 'cash' && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-6 mb-4">
                <div className="flex items-center gap-3">
                  <Check className="w-6 h-6 text-green-600" />
                  <div>
                    <p className="font-medium text-green-900">Payment Confirmed</p>
                    <p className="text-sm text-green-700">₱{calculateTotal().toFixed(2)} paid via {reservationData.paymentMethod === 'card' ? 'Card' : 'QR Payment'}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-purple-50 border border-purple-200 rounded-xl p-8">
              <div className="text-center">
                <p className="text-sm text-purple-800 mb-2">Total Amount</p>
                <p className="text-5xl font-bold text-purple-600 mb-3">₱{calculateTotal().toFixed(2)}</p>
                <p className="text-gray-600">Reservation Payment</p>
              </div>
            </div>

            <div className="bg-gray-50 rounded-xl p-6 space-y-2">
              <p className="text-gray-600">Desk: <span className="font-medium">{desk.name}</span></p>
              <p className="text-gray-600">Date: <span className="font-medium">{reservationData.date}</span></p>
              <p className="text-gray-600">Time: <span className="font-medium">{reservationData.timeSlot}</span></p>
              <p className="text-gray-600">Duration: <span className="font-medium">{reservationData.customDuration || reservationData.duration} hours</span></p>
              <p className="text-gray-600">Name: <span className="font-medium">{reservationData.fullName}</span></p>
              <p className="text-gray-600">Email: <span className="font-medium">{reservationData.email}</span></p>

              {isPendingSlot && reservationData.alternativeDateTime && (
                <div className="pt-3 mt-3 border-t border-gray-300">
                  <p className="text-sm font-semibold text-gray-700 mb-2">Alternative (if primary is taken):</p>
                  <p className="text-sm text-gray-600">Desk: <span className="font-medium">{allDesks.find(d => d.id === reservationData.alternativeDesks?.[0])?.name}</span></p>
                  <p className="text-sm text-gray-600">Date: <span className="font-medium">{reservationData.alternativeDateTime.date}</span></p>
                  <p className="text-sm text-gray-600">Time: <span className="font-medium">{reservationData.alternativeDateTime.timeSlot}</span></p>
                </div>
              )}
            </div>

            {reservationData.paymentMethod === 'cash' ? (
              <button
                onClick={handlePaymentConfirm}
                className="w-full bg-green-600 hover:bg-green-700 text-white py-4 rounded-xl text-lg font-medium transition-colors"
              >
                Pay at the Counter
              </button>
            ) : (
              <button
                onClick={handlePaymentConfirm}
                className="w-full bg-purple-600 hover:bg-purple-700 text-white py-4 rounded-xl text-lg font-medium transition-colors"
              >
                Complete Reservation
              </button>
            )}
          </div>
        )}

        {/* Step 7: QR Code */}
        {step === 7 && (
          <div className="space-y-6 max-w-2xl mx-auto">
            {isAlternativeAssigned && !showConfirmation && (
              <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl p-6 mb-6">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-6 h-6 text-yellow-600 mt-1" />
                  <div>
                    <p className="font-semibold text-yellow-900 mb-2">📧 Desk & Time Assignment Update</p>
                    <p className="text-yellow-800 mb-2">
                      Your primary choice <span className="font-semibold">{desk.name}</span> at <span className="font-semibold">{reservationData.timeSlot}</span> on <span className="font-semibold">{reservationData.date}</span> was confirmed by another user who completed their pending cash payment.
                    </p>
                    <p className="text-yellow-800 mb-3">
                      You have been automatically assigned to your alternative:
                    </p>
                    <div className="bg-white rounded-lg p-3 mb-2">
                      <p className="font-semibold text-yellow-900">Desk: {assignedDesk}</p>
                      {reservationData.alternativeDateTime && (
                        <>
                          <p className="font-semibold text-yellow-900">Date: {reservationData.alternativeDateTime.date}</p>
                          <p className="font-semibold text-yellow-900">Time: {reservationData.alternativeDateTime.timeSlot}</p>
                        </>
                      )}
                    </div>
                    <p className="text-xs text-yellow-700 italic">
                      An email notification has been sent with these details.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="text-center">
              <div className={`inline-flex items-center justify-center w-20 h-20 rounded-full mb-4 ${
                isAlternativeAssigned ? 'bg-yellow-100' : 'bg-green-100'
              }`}>
                <Check className={`w-10 h-10 ${isAlternativeAssigned ? 'text-yellow-600' : 'text-green-600'}`} />
              </div>
              <h2 className="text-3xl font-semibold mb-2">
                {reservationData.paymentMethod === 'cash' ? 'Please Proceed to Counter' : 'Reservation Confirmed!'}
              </h2>
              <p className="text-gray-600 text-lg">
                {reservationData.paymentMethod === 'cash'
                  ? 'Complete your payment at the counter'
                  : isAlternativeAssigned ? 'Your alternative space is reserved' : 'Your space is reserved'}
              </p>
            </div>

            {reservationData.paymentMethod === 'cash' ? (
              /* Queue Number Display for Cash Payments */
              <div className="bg-white border-2 border-gray-200 rounded-2xl p-8">
                <div className="bg-orange-50 border-4 border-orange-500 rounded-2xl p-12 text-center mb-6">
                  <p className="text-lg font-medium text-orange-900 mb-2">Your Queue Number</p>
                  <p className="text-8xl font-bold text-orange-600 mb-4">{queueNumber}</p>
                  <p className="text-sm text-orange-800">Please proceed to the counter with this number</p>
                </div>

                <div className="bg-gray-50 rounded-xl p-6 space-y-2">
                  <h3 className="font-semibold text-lg mb-3">Reservation Details</h3>
                  <p className="text-gray-600">
                    {isAlternativeAssigned ? 'Assigned Desk:' : 'Desk:'}
                    <span className="font-medium"> {assignedDesk}</span>
                  </p>
                  <p className="text-gray-600">Zone: <span className="font-medium">
                    {isAlternativeAssigned
                      ? allDesks.find(d => d.name === assignedDesk)?.zone
                      : desk.zone}
                  </span></p>
                  <p className="text-gray-600">Date: <span className="font-medium">
                    {isAlternativeAssigned && reservationData.alternativeDateTime
                      ? reservationData.alternativeDateTime.date
                      : reservationData.date}
                  </span></p>
                  <p className="text-gray-600">Time: <span className="font-medium">
                    {isAlternativeAssigned && reservationData.alternativeDateTime
                      ? reservationData.alternativeDateTime.timeSlot
                      : reservationData.timeSlot}
                  </span></p>
                  <p className="text-gray-600">Duration: <span className="font-medium">{reservationData.customDuration || reservationData.duration} hours</span></p>
                  <p className="text-gray-600">Total: <span className="font-medium text-lg">₱{calculateTotal().toFixed(2)}</span></p>
                </div>

                <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                  <p className="text-sm text-center text-blue-800">
                    📧 Once staff processes your payment, a QR code will be sent to <span className="font-medium">{reservationData.email}</span>
                  </p>
                </div>
              </div>
            ) : (
              /* QR Code Display for Card/QR Payments */
              <div className="bg-white border-2 border-gray-200 rounded-2xl p-8">
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6">
                  <p className="text-sm text-green-800 text-center">
                    ✓ Payment confirmed • Staff notified • Desk status: <span className="font-semibold">RESERVED</span>
                  </p>
                </div>

                <div className="flex justify-center mb-6">
                  <QRCodeSVG value={qrData} size={256} level="H" />
                </div>

              <div className="bg-gray-50 rounded-xl p-6 space-y-2">
                <h3 className="font-semibold text-lg mb-3">Reservation Details</h3>
                <p className="text-gray-600">
                  {isAlternativeAssigned ? 'Assigned Desk:' : 'Desk:'}
                  <span className="font-medium"> {assignedDesk}</span>
                </p>
                <p className="text-gray-600">Zone: <span className="font-medium">
                  {isAlternativeAssigned
                    ? allDesks.find(d => d.name === assignedDesk)?.zone
                    : desk.zone}
                </span></p>
                <p className="text-gray-600">Date: <span className="font-medium">
                  {isAlternativeAssigned && reservationData.alternativeDateTime
                    ? reservationData.alternativeDateTime.date
                    : reservationData.date}
                </span></p>
                <p className="text-gray-600">Time: <span className="font-medium">
                  {isAlternativeAssigned && reservationData.alternativeDateTime
                    ? reservationData.alternativeDateTime.timeSlot
                    : reservationData.timeSlot}
                </span></p>
                <p className="text-gray-600">Duration: <span className="font-medium">{reservationData.customDuration || reservationData.duration} hours</span></p>
                <p className="text-gray-600">Total: <span className="font-medium text-lg">₱{calculateTotal().toFixed(2)}</span></p>

                {reservationData.alternativeDesks && reservationData.alternativeDesks.length > 0 && (
                  <div className="pt-3 mt-3 border-t">
                    <p className="font-medium mb-2">Alternative Spaces:</p>
                    {reservationData.alternativeDesks.map(deskId => {
                      const altDesk = allDesks.find(d => d.id === deskId);
                      return altDesk ? (
                        <p key={deskId} className="text-sm text-gray-600">• {altDesk.name} ({altDesk.zone})</p>
                      ) : null;
                    })}
                  </div>
                )}
              </div>

                <div className="mt-6 p-4 bg-purple-50 border border-purple-200 rounded-xl">
                  <p className="text-sm text-center text-purple-800">
                    ✉️ A copy of your reservation QR code has been sent to <span className="font-medium">{reservationData.email}</span>
                  </p>
                </div>
              </div>
            )}

            <button
              onClick={onBack}
              className="w-full bg-gray-600 hover:bg-gray-700 text-white py-4 rounded-xl text-lg font-medium transition-colors"
            >
              Return to Map
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}
