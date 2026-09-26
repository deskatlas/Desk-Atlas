import { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router";
import { Calendar, Clock, MapPin, AlertCircle, CheckCircle, XCircle, Info } from "lucide-react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { RESERVATION_STATUS, RESERVATION_STATUS_LABEL, type ReservationStatus } from "../lib/reservationStatus";

interface BookingDetails {
  referenceCode: string;
  customerName: string;
  workspace: string;
  date: string;
  time: string;
  status: ReservationStatus;
}

type ViewState = "entry" | "details" | "reschedule" | "cancel-confirm" | "cancel-verify" | "cancelled";

export function ManageBookingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [viewState, setViewState] = useState<ViewState>("entry");
  const [referenceCode, setReferenceCode] = useState("");
  const [error, setError] = useState("");
  const [bookingDetails, setBookingDetails] = useState<BookingDetails | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [showCalendar, setShowCalendar] = useState(false);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null);
  const [newTime, setNewTime] = useState("");
  const [availabilityStatus, setAvailabilityStatus] = useState<"checking" | "available" | "unavailable" | null>(null);
  const [availableTimes, setAvailableTimes] = useState<string[]>([]);
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationError, setVerificationError] = useState("");

  const calendarRef = useRef<HTMLDivElement>(null);

  // Get alternative workspaces from location state (passed from reservation flow)
  const alternativeWorkspaces = location.state?.alternativeWorkspaces || [
    "Study Desk A5",
    "Study Desk A7",
    "Study Desk A9",
    "Study Desk A11"
  ];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (calendarRef.current && !calendarRef.current.contains(event.target as Node)) {
        setShowCalendar(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Simulated booking data
  const mockBooking: BookingDetails = {
    referenceCode: "SKYDY-2026-00125",
    customerName: "Juan Dela Cruz",
    workspace: "Study Desk A3",
    date: "June 10, 2026",
    time: "10:00 AM – 2:00 PM",
    status: RESERVATION_STATUS.CONFIRMED,
  };

  const handleVerify = () => {
    setError("");

    // Simulate validation
    if (referenceCode.toUpperCase() === mockBooking.referenceCode) {
      setBookingDetails(mockBooking);
      setViewState("details");
    } else {
      setError("Invalid reference code. Please check your booking email and try again.");
    }
  };

  const handleCheckAvailability = () => {
    setAvailabilityStatus("checking");

    // Simulate availability check
    setTimeout(() => {
      // Random availability for demo
      const isAvailable = Math.random() > 0.3;
      setAvailabilityStatus(isAvailable ? "available" : "unavailable");
    }, 1000);
  };

  const handleWorkspaceSelect = (workspaceId: string) => {
    setSelectedWorkspace(workspaceId);
    setNewTime("");

    // Simulate fetching available times for the selected workspace
    const mockAvailableTimes = [
      "8:00 AM - 12:00 PM",
      "10:00 AM - 2:00 PM",
      "12:00 PM - 4:00 PM",
      "2:00 PM - 6:00 PM",
    ];
    setAvailableTimes(mockAvailableTimes);
  };

  const handleConfirmReschedule = () => {
    // Simulate successful reschedule
    alert(`Your booking has been successfully rescheduled to ${selectedWorkspace} on ${selectedDate?.toLocaleDateString()} at ${newTime}. A confirmation email with your updated booking details will be sent to your registered email address.`);
    setViewState("details");
    setAvailabilityStatus(null);
    setSelectedDate(undefined);
    setSelectedWorkspace(null);
    setNewTime("");
    setAvailableTimes([]);
  };

  const handleVerifyCode = () => {
    setVerificationError("");

    // Verify the code matches the booking reference
    if (verificationCode.toUpperCase() === bookingDetails?.referenceCode) {
      setViewState("cancel-confirm");
    } else {
      setVerificationError("Invalid reference code. Please try again.");
    }
  };

  const handleConfirmCancellation = () => {
    setViewState("cancelled");
    setVerificationCode("");
  };

  // Check if actions are allowed (simulate business rule)
  const actionsAllowed = true; // In real app, this would check if booking is within allowed period

  return (
    <div className="min-h-screen bg-gray-50 py-16">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Entry View */}
        {viewState === "entry" && (
          <div className="bg-white rounded-xl shadow-md border border-gray-200 p-8">
            <h1 className="text-3xl font-semibold text-gray-900 mb-4 text-center">
              Manage Booking
            </h1>
            <p className="text-gray-600 text-center mb-8">
              Enter your booking reference code to view and manage your reservation.
            </p>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Reference Code
                </label>
                <input
                  type="text"
                  value={referenceCode}
                  onChange={(e) => {
                    setReferenceCode(e.target.value);
                    setError("");
                  }}
                  className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 ${
                    error ? "border-red-500" : "border-gray-300"
                  }`}
                  placeholder="Enter your reference code"
                />
                {error && (
                  <div className="mt-2 flex items-center gap-2 text-red-600 text-sm">
                    <AlertCircle className="w-4 h-4" />
                    <span>{error}</span>
                  </div>
                )}
                <p className="text-xs text-gray-500 mt-2">
                  You can find your reference code in your booking confirmation email.
                </p>
              </div>

              <button
                onClick={handleVerify}
                className="w-full px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors font-medium"
              >
                Verify Booking
              </button>
            </div>

            <div className="mt-8 space-y-4">
              <h3 className="font-semibold text-gray-900 mb-4">Important Reminders</h3>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-3">
                <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-gray-800">
                  Rescheduling and Cancellation is not allowed on the date of booking
                </p>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
                <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-gray-800">
                  Rescheduling is only allowed if done at least 24 hours before the booked date
                </p>
              </div>

              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
                <Info className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-gray-800">
                  Cancellation is only allowed and refundable if done at least 48 hours before the booked date (50% refund)
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Booking Details View */}
        {viewState === "details" && bookingDetails && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-md border border-gray-200 p-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-6">Booking Details</h2>

              <div className="space-y-4">
                <div className="flex items-start gap-3 pb-4 border-b border-gray-200">
                  <div className="flex-1">
                    <p className="text-sm text-gray-600">Reference Code</p>
                    <p className="text-lg font-semibold text-gray-900">{bookingDetails.referenceCode}</p>
                  </div>
                  <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
                    {RESERVATION_STATUS_LABEL[bookingDetails.status]}
                  </span>
                </div>

                <div>
                  <p className="text-sm text-gray-600">Customer Name</p>
                  <p className="text-base text-gray-900">{bookingDetails.customerName}</p>
                </div>

                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-gray-500" />
                  <div>
                    <p className="text-sm text-gray-600">Workspace</p>
                    <p className="text-base text-gray-900">{bookingDetails.workspace}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-gray-500" />
                  <div>
                    <p className="text-sm text-gray-600">Booking Date</p>
                    <p className="text-base text-gray-900">{bookingDetails.date}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-gray-500" />
                  <div>
                    <p className="text-sm text-gray-600">Time</p>
                    <p className="text-base text-gray-900">{bookingDetails.time}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-md border border-gray-200 p-8">
              <h3 className="font-semibold text-gray-900 mb-4">Manage Your Booking</h3>

              <div className="space-y-3">
                <button
                  onClick={() => setViewState("reschedule")}
                  disabled={!actionsAllowed}
                  className={`w-full px-6 py-3 rounded-lg font-medium transition-colors ${
                    actionsAllowed
                      ? "bg-teal-600 text-white hover:bg-teal-700"
                      : "bg-gray-300 text-gray-500 cursor-not-allowed"
                  }`}
                >
                  Reschedule Booking
                </button>

                <button
                  onClick={() => setViewState("cancel-verify")}
                  disabled={!actionsAllowed}
                  className={`w-full px-6 py-3 rounded-lg font-medium transition-colors ${
                    actionsAllowed
                      ? "border-2 border-red-600 text-red-600 hover:bg-red-50"
                      : "border-2 border-gray-300 text-gray-500 cursor-not-allowed"
                  }`}
                >
                  Cancel Booking
                </button>
              </div>

              <p className="text-xs text-gray-500 mt-4 text-center">
                Rescheduling and cancellation are only available within the allowed time period set by the business.
              </p>
            </div>

            <button
              onClick={() => setViewState("entry")}
              className="w-full px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
            >
              Back to Entry
            </button>
          </div>
        )}

        {/* Reschedule View */}
        {viewState === "reschedule" && bookingDetails && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-md border border-gray-200 p-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">Reschedule Booking</h2>

              <div className="space-y-4 mb-6">
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-sm text-gray-600 mb-1">Current Booking</p>
                  <p className="text-base font-medium text-gray-900">
                    {bookingDetails.workspace} - {bookingDetails.date} at {bookingDetails.time}
                  </p>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-gray-600 mb-2">Alternative Workspaces</p>
                  <ul className="text-sm text-gray-900 space-y-1">
                    {alternativeWorkspaces.map((workspace: string, index: number) => (
                      <li key={index} className="font-medium">
                        {index + 1}. {workspace}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="space-y-4">
                {/* Date Selection */}
                <div className="relative" ref={calendarRef}>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select New Date
                  </label>
                  <button
                    onClick={() => setShowCalendar(!showCalendar)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 flex items-center justify-between bg-white hover:bg-gray-50 text-left"
                  >
                    <span className={selectedDate ? "text-gray-900" : "text-gray-400"}>
                      {selectedDate ? selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : "--- dd, yyyy"}
                    </span>
                    <Calendar className="w-5 h-5 text-gray-500" />
                  </button>
                  {showCalendar && (
                    <div className="absolute top-full mt-2 z-50 bg-white border border-gray-300 rounded-lg shadow-lg p-4">
                      <DayPicker
                        mode="single"
                        selected={selectedDate}
                        onSelect={(date) => {
                          setSelectedDate(date);
                          setShowCalendar(false);
                          setSelectedWorkspace(null);
                          setNewTime("");
                          setAvailableTimes([]);
                        }}
                        className="rdp-custom"
                        disabled={(date) => {
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          if (date < today) return true;
                          const maxDate = new Date(today);
                          maxDate.setDate(maxDate.getDate() + 90);
                          return date > maxDate;
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Workspace Map - Show after date is selected */}
                {selectedDate && (
                  <div className="border border-gray-300 rounded-lg p-6 bg-gray-50">
                    <h3 className="font-semibold text-gray-900 mb-4">Select Workspace</h3>

                    {/* Legend */}
                    <div className="flex flex-wrap gap-4 text-sm mb-6">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 bg-green-500 rounded"></div>
                        <span className="text-gray-700">Available</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 bg-yellow-500 rounded"></div>
                        <span className="text-gray-700">Pending</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 bg-red-500 rounded"></div>
                        <span className="text-gray-700">Reserved</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 bg-gray-400 rounded"></div>
                        <span className="text-gray-700">Occupied</span>
                      </div>
                    </div>

                    {/* Map Grid */}
                    <div className="space-y-8">
                      {/* Zone A and B */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Zone A */}
                        <div>
                          <h4 className="text-center font-semibold text-gray-700 mb-4">Zone A</h4>
                          <div className="space-y-2">
                            <div className="flex gap-2 justify-center">
                              {["A1", "A2", "A3", "A4"].map((id) => (
                                <button
                                  key={id}
                                  onClick={() => handleWorkspaceSelect(id)}
                                  className={`w-14 h-14 rounded-md font-medium text-white text-sm transition-all ${
                                    selectedWorkspace === id
                                      ? "ring-4 ring-teal-600 bg-green-500"
                                      : id === "A3"
                                      ? "bg-yellow-500 hover:bg-yellow-600"
                                      : "bg-green-500 hover:bg-green-600"
                                  }`}
                                >
                                  {id}
                                </button>
                              ))}
                            </div>
                            <div className="flex gap-2 justify-center">
                              {["A5", "A6", "A7", "A8"].map((id) => (
                                <button
                                  key={id}
                                  onClick={() => handleWorkspaceSelect(id)}
                                  className={`w-14 h-14 rounded-md font-medium text-white text-sm transition-all ${
                                    selectedWorkspace === id
                                      ? "ring-4 ring-teal-600 bg-green-500"
                                      : id === "A5"
                                      ? "bg-red-500 hover:bg-red-600"
                                      : id === "A8"
                                      ? "bg-gray-400 hover:bg-gray-500"
                                      : "bg-green-500 hover:bg-green-600"
                                  }`}
                                >
                                  {id}
                                </button>
                              ))}
                            </div>
                            <div className="flex gap-2 justify-center">
                              {["A9", "A10", "A11", "A12"].map((id) => (
                                <button
                                  key={id}
                                  onClick={() => handleWorkspaceSelect(id)}
                                  className={`w-14 h-14 rounded-md font-medium text-white text-sm transition-all ${
                                    selectedWorkspace === id
                                      ? "ring-4 ring-teal-600 bg-green-500"
                                      : id === "A11"
                                      ? "bg-yellow-500 hover:bg-yellow-600"
                                      : "bg-green-500 hover:bg-green-600"
                                  }`}
                                >
                                  {id}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Zone B */}
                        <div>
                          <h4 className="text-center font-semibold text-gray-700 mb-4">Zone B</h4>
                          <div className="space-y-2">
                            <div className="flex gap-2 justify-center">
                              {["B1", "B2", "B3", "B4"].map((id) => (
                                <button
                                  key={id}
                                  onClick={() => handleWorkspaceSelect(id)}
                                  className={`w-14 h-14 rounded-md font-medium text-white text-sm transition-all ${
                                    selectedWorkspace === id
                                      ? "ring-4 ring-teal-600 bg-green-500"
                                      : id === "B4"
                                      ? "bg-red-500 hover:bg-red-600"
                                      : "bg-green-500 hover:bg-green-600"
                                  }`}
                                >
                                  {id}
                                </button>
                              ))}
                            </div>
                            <div className="flex gap-2 justify-center">
                              {["B5", "B6", "B7", "B8"].map((id) => (
                                <button
                                  key={id}
                                  onClick={() => handleWorkspaceSelect(id)}
                                  className={`w-14 h-14 rounded-md font-medium text-white text-sm transition-all ${
                                    selectedWorkspace === id
                                      ? "ring-4 ring-teal-600 bg-green-500"
                                      : "bg-green-500 hover:bg-green-600"
                                  }`}
                                >
                                  {id}
                                </button>
                              ))}
                            </div>
                            <div className="flex gap-2 justify-center">
                              {["B9", "B10", "B11", "B12"].map((id) => (
                                <button
                                  key={id}
                                  onClick={() => handleWorkspaceSelect(id)}
                                  className={`w-14 h-14 rounded-md font-medium text-white text-sm transition-all ${
                                    selectedWorkspace === id
                                      ? "ring-4 ring-teal-600 bg-green-500"
                                      : id === "B10" || id === "B11"
                                      ? "bg-yellow-500 hover:bg-yellow-600"
                                      : "bg-green-500 hover:bg-green-600"
                                  }`}
                                >
                                  {id}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Meeting Rooms */}
                      <div>
                        <h4 className="text-center font-semibold text-gray-700 mb-4">Meeting Rooms</h4>
                        <div className="flex gap-3 justify-center flex-wrap">
                          {["Meeting-1", "Meeting-2", "Meeting-3", "Booth-1", "Booth-2"].map((id) => (
                            <button
                              key={id}
                              onClick={() => handleWorkspaceSelect(id)}
                              className={`px-6 py-8 rounded-md font-medium text-white transition-all ${
                                selectedWorkspace === id
                                  ? "ring-4 ring-teal-600 bg-green-500"
                                  : id === "Meeting-2"
                                  ? "bg-red-500 hover:bg-red-600"
                                  : "bg-green-500 hover:bg-green-600"
                              }`}
                            >
                              {id.replace("-", " ")}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Available Times - Show after workspace is selected */}
                {selectedWorkspace && availableTimes.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Available Times for {selectedWorkspace}
                    </label>
                    <select
                      value={newTime}
                      onChange={(e) => setNewTime(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                    >
                      <option value="">Select time slot</option>
                      {availableTimes.map((time) => (
                        <option key={time} value={time}>
                          {time}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Confirm Button */}
                {selectedDate && selectedWorkspace && newTime && (
                  <button
                    onClick={handleConfirmReschedule}
                    className="w-full px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors font-medium"
                  >
                    Confirm Reschedule
                  </button>
                )}
              </div>
            </div>

            <button
              onClick={() => {
                setViewState("details");
                setAvailabilityStatus(null);
                setSelectedDate(undefined);
                setSelectedWorkspace(null);
                setNewTime("");
                setAvailableTimes([]);
              }}
              className="w-full px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
            >
              Back to Booking Details
            </button>
          </div>
        )}

        {/* Cancel Verification View */}
        {viewState === "cancel-verify" && (
          <div className="bg-white rounded-xl shadow-md border border-gray-200 p-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4 text-center">
              Verify Cancellation
            </h2>
            <p className="text-gray-600 mb-6 text-center">
              To confirm cancellation, please enter your booking reference code
            </p>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Reference Code
                </label>
                <input
                  type="text"
                  value={verificationCode}
                  onChange={(e) => {
                    setVerificationCode(e.target.value);
                    setVerificationError("");
                  }}
                  className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 ${
                    verificationError ? "border-red-500" : "border-gray-300"
                  }`}
                  placeholder="Enter your reference code"
                />
                {verificationError && (
                  <div className="mt-2 flex items-center gap-2 text-red-600 text-sm">
                    <AlertCircle className="w-4 h-4" />
                    <span>{verificationError}</span>
                  </div>
                )}
              </div>

              <div className="flex gap-4">
                <button
                  onClick={() => {
                    setViewState("details");
                    setVerificationCode("");
                    setVerificationError("");
                  }}
                  className="flex-1 px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                >
                  Back
                </button>
                <button
                  onClick={handleVerifyCode}
                  className="flex-1 px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors font-medium"
                >
                  Verify
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Cancel Confirmation View */}
        {viewState === "cancel-confirm" && (
          <div className="bg-white rounded-xl shadow-md border border-gray-200 p-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4 text-center">
              Cancel Booking?
            </h2>
            <p className="text-gray-600 mb-8 text-center">
              Are you sure you want to cancel this booking? Once confirmed, a cancellation email containing the refund form will be sent to your registered email address.
            </p>

            <div className="flex gap-4">
              <button
                onClick={() => {
                  setViewState("details");
                  setVerificationCode("");
                  setVerificationError("");
                }}
                className="flex-1 px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              >
                No, Keep Booking
              </button>
              <button
                onClick={handleConfirmCancellation}
                className="flex-1 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
              >
                Yes, Cancel Booking
              </button>
            </div>
          </div>
        )}

        {/* Cancellation Success View */}
        {viewState === "cancelled" && (
          <div className="bg-white rounded-xl shadow-md border border-gray-200 p-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>

            <h2 className="text-2xl font-semibold text-gray-900 mb-4">
              Your booking has been cancelled successfully.
            </h2>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6 text-left">
              <p className="text-gray-800">
                A cancellation email with a refund form has been sent to your registered email address. Please complete the form by providing your account name, account number, and uploading your QR code with consent for refund processing.
              </p>
            </div>

            <button
              onClick={() => navigate("/")}
              className="w-full px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors font-medium"
            >
              Back to Home
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
