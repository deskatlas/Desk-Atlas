"use client";

import { useState } from 'react';
import { Star, X, Calendar, Clock, ChevronLeft, ChevronRight } from 'lucide-react';

export type DeskStatus = 'available' | 'pending' | 'reserved' | 'occupied';

export type RecommendationType =
  | 'window'
  | 'cr'
  | 'reception'
  | 'quiet'
  | 'private'
  | 'meeting-rooms'
  | null;

export interface Desk {
  id: string;
  workspaceInstanceId?: string;
  name: string;
  type: 'desk' | 'meeting-room' | 'phone-booth';
  zone: string;
  status: DeskStatus;
  occupiedUntil?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  hourlyRate: number;
  dayRate: number;
}

export interface KioskMarker {
  x: number;
  y: number;
  label?: string;
  color?: string;
}

interface WorkspaceMapProps {
  desks: Desk[];
  onDeskClick: (desk: Desk) => void;
  selectedDeskId?: string;
  highlightedDeskIds?: string[];
  interactiveZone?: string;
  kioskMarker?: KioskMarker | null;
}

const statusColors: Record<DeskStatus, string> = {
  available: 'fill-green-500 hover:fill-green-600',
  pending: 'fill-yellow-500 hover:fill-yellow-600',
  reserved: 'fill-red-500 hover:fill-red-600',
  occupied: 'fill-gray-400'
};

const recommendationMap: Record<string, RecommendationType[]> = {
  'B4': ['window'],
  'B8': ['window'],
  'B12': ['window', 'private'],
  'PB2': ['window', 'meeting-rooms'],
  'MR3': ['window', 'meeting-rooms'],
  'A9': ['cr'],
  'A10': ['cr'],
  'A11': ['cr'],
  'PB1': ['cr', 'meeting-rooms'],
  'A1': ['reception', 'private'],
  'A2': ['reception'],
  'A3': ['reception'],
  'A4': ['reception'],
  'A12': ['quiet', 'private'],
  'B9': ['quiet'],
  'B10': ['quiet'],
  'B11': ['quiet'],
  'B1': ['private'],
  'MR1': ['meeting-rooms'],
  'MR2': ['meeting-rooms']
};

const recommendationLabels: Record<Exclude<RecommendationType, null>, string> = {
  window: 'Near the window',
  cr: 'Near the CR',
  reception: 'Near the reception/front desk',
  quiet: 'In a quieter area',
  private: 'More private corner workspace',
  'meeting-rooms': 'Near meeting rooms'
};

export function WorkspaceMap({ desks, onDeskClick, selectedDeskId, highlightedDeskIds = [], interactiveZone, kioskMarker }: WorkspaceMapProps) {
  const [hoveredDesk, setHoveredDesk] = useState<string | null>(null);
  const [showRecommendations, setShowRecommendations] = useState(false);
  const [recommendationType, setRecommendationType] = useState<RecommendationType>(null);
  const [recommendationPopup, setRecommendationPopup] = useState<{
    desk: Desk;
    x: number;
    y: number;
  } | null>(null);

  // Calendar state
  const [currentMonth, setCurrentMonth] = useState(new Date(2026, 4, 1)); // May 2026
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string | null>(null);

  // Calendar helpers
  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();
    return { daysInMonth, startingDayOfWeek };
  };

  const handleDateSelect = (day: number) => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    setSelectedDate(dateString);
    setSelectedTimeSlot(null);
  };

  // Available time slots
  const availableTimeSlots = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];

  const { daysInMonth, startingDayOfWeek } = getDaysInMonth(currentMonth);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Check if desk is recommended based on current recommendation type
  const isRecommended = (desk: Desk): boolean => {
    if (!showRecommendations || !recommendationType) return false;
    const recommendations = recommendationMap[desk.id] || [];
    return recommendations.includes(recommendationType);
  };

  // Get recommendation reason for a desk
  const getRecommendationReason = (desk: Desk): string => {
    if (!recommendationType) return '';
    return `Recommended: ${recommendationLabels[recommendationType]}`;
  };

  // Handle desk click with recommendation popup
  const handleDeskClick = (desk: Desk, event: React.MouseEvent<SVGGElement>) => {
    if (showRecommendations && isRecommended(desk)) {
      setRecommendationPopup({
        desk,
        x: desk.x,
        y: desk.y
      });
    } else {
      setRecommendationPopup(null);
      onDeskClick(desk);
    }
  };

  return (
    <div className="w-full h-full flex flex-col gap-4">
      {/* Map Legend and Controls */}
      <div className="bg-white rounded-lg shadow-sm p-4">
        <div className="flex items-center justify-between gap-6 flex-wrap">
          {/* Status Legend */}
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-green-500 rounded"></div>
              <span className="text-sm">Available</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-yellow-500 rounded"></div>
              <span className="text-sm">Pending</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-red-500 rounded"></div>
              <span className="text-sm">Reserved</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-gray-400 rounded"></div>
              <span className="text-sm">Occupied</span>
            </div>
          </div>

          {/* Recommendation Controls */}
          <div className="flex items-center gap-4">
            {/* Toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showRecommendations}
                onChange={(e) => {
                  setShowRecommendations(e.target.checked);
                  if (!e.target.checked) {
                    setRecommendationPopup(null);
                  }
                }}
                className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
              />
              <span className="text-sm font-medium">Show Recommended Workspaces</span>
            </label>

            {/* Preference Dropdown */}
            {showRecommendations && (
              <select
                value={recommendationType || ''}
                onChange={(e) => {
                  setRecommendationType((e.target.value || null) as RecommendationType);
                  setRecommendationPopup(null);
                }}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="">Select Preference</option>
                <option value="window">Near the window</option>
                <option value="cr">Near the CR</option>
                <option value="reception">Near the reception</option>
                <option value="quiet">Quiet area</option>
                <option value="private">Private area</option>
                <option value="meeting-rooms">Near meeting rooms</option>
              </select>
            )}
          </div>
        </div>
      </div>

      {/* Interactive Map */}
      <div className="flex-1 bg-white rounded-lg shadow-lg p-8 overflow-auto relative">
        <svg viewBox="0 0 1300 650" className="w-full h-full">
          {/* Background grid */}
          <defs>
            <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
              <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#e5e7eb" strokeWidth="1"/>
            </pattern>
          </defs>
          <rect width="1300" height="650" fill="url(#grid)" />

          {/* Interactive Zone Highlight */}
          {interactiveZone && (
            <>
              {interactiveZone === 'Zone A' && (
                <rect x="190" y="60" width="330" height="290" fill="none" stroke="#3B82F6" strokeWidth="4" strokeDasharray="10,5" rx="12" opacity="0.6" />
              )}
              {interactiveZone === 'Zone B' && (
                <rect x="820" y="60" width="330" height="290" fill="none" stroke="#3B82F6" strokeWidth="4" strokeDasharray="10,5" rx="12" opacity="0.6" />
              )}
              {interactiveZone === 'Meeting Rooms' && (
                <rect x="270" y="390" width="860" height="130" fill="none" stroke="#3B82F6" strokeWidth="4" strokeDasharray="10,5" rx="12" opacity="0.6" />
              )}
            </>
          )}

          {/* Zone labels */}
          <text
            x="320"
            y="70"
            className="fill-gray-700 text-3xl font-semibold"
            style={{ opacity: interactiveZone && interactiveZone !== 'Zone A' ? 0.3 : 1 }}
          >
            Zone A
          </text>
          <text
            x="950"
            y="70"
            className="fill-gray-700 text-3xl font-semibold"
            style={{ opacity: interactiveZone && interactiveZone !== 'Zone B' ? 0.3 : 1 }}
          >
            Zone B
          </text>
          <text
            x="590"
            y="420"
            className="fill-gray-700 text-3xl font-semibold"
            style={{ opacity: interactiveZone && interactiveZone !== 'Meeting Rooms' ? 0.3 : 1 }}
          >
            Meeting Rooms
          </text>

          {/* Desks and Rooms */}
          {desks.map((desk) => {
            const isSelected = desk.id === selectedDeskId;
            const isHighlighted = highlightedDeskIds.includes(desk.id);
            const isHovered = hoveredDesk === desk.id;
            const recommended = isRecommended(desk);
            const isInteractive = !interactiveZone || desk.zone === interactiveZone;
            const isNonInteractive = interactiveZone && desk.zone !== interactiveZone;

            return (
              <g
                key={desk.id}
                onMouseEnter={() => isInteractive && setHoveredDesk(desk.id)}
                onMouseLeave={() => setHoveredDesk(null)}
                onClick={(e) => isInteractive && handleDeskClick(desk, e)}
                className={isInteractive ? 'cursor-pointer' : 'cursor-default'}
              >
                <rect
                  x={desk.x}
                  y={desk.y}
                  width={desk.width}
                  height={desk.height}
                  className={`${statusColors[desk.status]} transition-all duration-200 ${
                    recommended
                      ? 'stroke-purple-600 stroke-4'
                      : isSelected || isHighlighted
                        ? 'stroke-purple-600 stroke-4'
                        : 'stroke-gray-300 stroke-2'
                  }`}
                  rx="8"
                  style={{
                    transform: isHovered ? 'scale(1.05)' : 'scale(1)',
                    transformOrigin: `${desk.x + desk.width / 2}px ${desk.y + desk.height / 2}px`,
                    opacity: isNonInteractive ? 0.3 : 1
                  }}
                />
                <text
                  x={desk.x + desk.width / 2}
                  y={desk.y + desk.height / 2}
                  className="fill-white text-lg font-semibold pointer-events-none"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{
                    opacity: isNonInteractive ? 0.5 : 1
                  }}
                >
                  {desk.name}
                </text>

                {/* Recommendation Star Icon */}
                {recommended && (
                  <g>
                    <circle
                      cx={desk.x + desk.width - 12}
                      cy={desk.y + 12}
                      r="10"
                      className="fill-purple-600"
                    />
                    <text
                      x={desk.x + desk.width - 12}
                      y={desk.y + 12}
                      className="fill-white text-xs pointer-events-none"
                      textAnchor="middle"
                      dominantBaseline="middle"
                    >
                      ★
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Kiosk "You Are Here" Marker */}
          {kioskMarker && (
            <g transform={`translate(${kioskMarker.x}, ${kioskMarker.y})`} className="pointer-events-none">
              <circle cx="0" cy="0" r="22" fill={kioskMarker.color || '#DC2626'} opacity="0.25" />
              <circle cx="0" cy="0" r="14" fill={kioskMarker.color || '#DC2626'} stroke="#FFFFFF" strokeWidth="2.5" />
              <circle cx="0" cy="0" r="4" fill="#FFFFFF" />
              <g transform="translate(0, 18)">
                <rect x="-50" y="0" width="100" height="22" rx="11" fill={kioskMarker.color || '#DC2626'} stroke="#FFFFFF" strokeWidth="1" />
                <text x="0" y="15" fill="#FFFFFF" fontSize="10" fontWeight="bold" textAnchor="middle">
                  {kioskMarker.label || 'You Are Here'}
                </text>
              </g>
            </g>
          )}
        </svg>

        {/* Recommendation Full-Screen Modal */}
        {recommendationPopup && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-auto">
              {/* Header */}
              <div className="sticky top-0 bg-white border-b px-8 py-6 flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                  <Star className="w-7 h-7 text-purple-600 fill-purple-600" />
                  <div>
                    <h2 className="text-3xl font-semibold">{recommendationPopup.desk.name}</h2>
                    <p className="text-sm text-purple-600 font-medium mt-1">
                      {getRecommendationReason(recommendationPopup.desk)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setRecommendationPopup(null);
                    setSelectedDate(null);
                    setSelectedTimeSlot(null);
                  }}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Split Content: Calendar + Time Slots */}
              <div className="grid md:grid-cols-2 gap-8 p-8">
                {/* Left: Calendar */}
                <div>
                  <h3 className="text-2xl font-semibold mb-6">Select Date</h3>

                  {/* Recommendation Badge */}
                  <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 mb-6">
                    <div className="flex items-start gap-2">
                      <Star className="w-5 h-5 text-purple-600 fill-purple-600 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-purple-900">
                          {getRecommendationReason(recommendationPopup.desk)}
                        </p>
                      </div>
                    </div>
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
                        const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const isPast = dateObj < today;
                        const isSelected = selectedDate === dateString;

                        return (
                          <button
                            key={day}
                            onClick={() => !isPast && handleDateSelect(day)}
                            disabled={isPast}
                            className={`aspect-square p-2 rounded-lg text-sm font-medium transition-colors ${
                              isPast
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

                {/* Right: Time Slots & Details */}
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

                      {/* Space Details */}
                      <div className="bg-gray-50 rounded-xl p-4 mb-6 space-y-2">
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Space:</span>
                          <span className="text-sm font-medium">{recommendationPopup.desk.name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Zone:</span>
                          <span className="text-sm font-medium">{recommendationPopup.desk.zone}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Status:</span>
                          <span className={`text-sm font-medium capitalize ${
                            recommendationPopup.desk.status === 'available' ? 'text-green-600' :
                            recommendationPopup.desk.status === 'pending' ? 'text-yellow-600' :
                            'text-red-600'
                          }`}>
                            {recommendationPopup.desk.status}
                          </span>
                        </div>
                        <div className="flex justify-between pt-2 border-t">
                          <span className="text-sm text-gray-600">Hourly:</span>
                          <span className="text-sm font-medium">₱{recommendationPopup.desk.hourlyRate}/hr</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Full Day:</span>
                          <span className="text-sm font-medium">₱{recommendationPopup.desk.dayRate}/day</span>
                        </div>
                      </div>

                      {/* Available Time Slots */}
                      <p className="text-gray-600 mb-4">Available time slots:</p>
                      <div className="grid grid-cols-2 gap-3 max-h-96 overflow-y-auto mb-6">
                        {availableTimeSlots.map(time => (
                          <button
                            key={time}
                            onClick={() => setSelectedTimeSlot(time)}
                            className={`p-4 border-2 rounded-xl font-medium transition-colors ${
                              selectedTimeSlot === time
                                ? 'border-purple-600 bg-purple-50'
                                : 'border-gray-300 hover:border-purple-600'
                            }`}
                          >
                            <Clock className="w-4 h-4 inline mr-2" />
                            {time}
                          </button>
                        ))}
                      </div>

                      {/* Book Now Button */}
                      {selectedTimeSlot && (
                        <button
                          onClick={() => {
                            setRecommendationPopup(null);
                            onDeskClick(recommendationPopup.desk);
                          }}
                          className="w-full bg-purple-600 hover:bg-purple-700 text-white py-4 rounded-xl text-lg font-medium transition-colors"
                        >
                          Book {recommendationPopup.desk.name} at {selectedTimeSlot}
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center justify-center h-64 text-gray-400">
                      <div className="text-center">
                        <Calendar className="w-12 h-12 mx-auto mb-3" />
                        <p>Select a date to see available times</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
