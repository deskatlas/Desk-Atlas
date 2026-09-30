# DeskAtlas - Reservation & Allocation Module Class Diagram

Detailed domain model for guest booking lifecycle, multi-candidate priority ranking, atomic allocation, and repository implementations.

```mermaid
classDiagram
    direction TB

    class ReservationStatus {
        <<enumeration>>
        PENDING_PAYMENT
        PAYMENT_UNDER_REVIEW
        PENDING_COUNTER_CONFIRMATION
        CONFIRMED
        CHECKED_IN
        COMPLETED
        CANCELLED
        EXPIRED
        NEEDS_MANUAL_RESOLUTION
    }

    class CandidateRank {
        <<enumeration>>
        MAIN
        ALT_1
        ALT_2
    }

    class ReservationSource {
        <<enumeration>>
        WEB
        KIOSK
    }

    class Reservation {
        <<aggregate root>>
        +UUID id
        +String referenceCode
        +String customerFirstName
        +String customerLastName
        +String customerEmail
        +String customerPhone
        +ReservationStatus status
        +ReservationSource source
        +UUID assignedWorkspaceInstanceId
        +Date bookingDate
        +Timestamp startAt
        +Timestamp endAt
        +Decimal totalAmount
        +Integer rescheduleCount
        +String cancellationReason
        +Timestamp cancelledAt
        +Timestamp checkedInAt
        +Timestamp checkedOutAt
        +Timestamp createdAt
        +Timestamp updatedAt
        +isConfirmed() bool
        +isCancellable() bool
        +isReschedulable() bool
        +isInSession() bool
        +hasAssignedSpot() bool
    }

    class ReservationCandidate {
        <<entity>>
        +UUID id
        +UUID reservationId
        +UUID workspaceInstanceId
        +Integer rank
        +Boolean isAssigned
        +Timestamp startAt
        +Timestamp endAt
        +Timestamp createdAt
        +assign() void
        +unassign() void
    }

    class AdminReservationService {
        <<domain service>>
        -AdminReservationRepository repository
        -TransactionalEmailService emailService
        +listReservations(filter, pagination) ReservationPage
        +getReservationDetail(id) AdminReservationDetail
        +approvePayment(attemptId, adminId) AllocationResult
        +rejectPayment(attemptId, reason) RejectResult
        +cancelReservation(id, reason, actor) CancelResult
        +rescheduleReservation(input) RescheduleResult
        +relocateReservation(input) RelocateResult
        +extendReservation(input) ExtendResult
        +flagManualResolution(id, reason) void
        +logClosurePhoneCall(id, notes) void
    }

    class CandidateValidationService {
        <<domain service>>
        +validateCandidates(candidates, templateId) CandidateValidationResult
    }

    class ReservationStatusService {
        <<domain service>>
        +computeEffectiveStatus(reservation, now) ReservationStatus
        +canTransition(from, to) bool
    }

    class ReservationSessionService {
        <<domain service>>
        +isSessionActive(reservation, now) bool
        +computeRemainingMinutes(reservation, now) Integer
    }

    class AdminReservationRepository {
        <<interface>>
        +listReservations(filter) Reservation[]
        +getReservationDetail(id) AdminReservationDetail
        +cancelReservation(input) void
        +rescheduleReservation(input) void
        +relocateReservation(input) void
        +extendReservation(input) void
    }

    class ReservationSupabaseRepository {
        <<repository>>
        -SupabaseClient client
        +createWebReservationWithPaymentSession(dto) ReservationResult
        +createKioskReservationWithCounterPayment(dto) ReservationResult
        +approveOnlinePaymentAndAllocate(attemptId, actorId) AllocationResult
        +confirmKioskPaymentAndAllocate(attemptId, actorId) AllocationResult
        +checkInReservation(id, actorId) CheckInResult
        +checkOutReservation(id, actorId) CheckOutResult
        +relocateReservation(input) RelocateResult
    }

    class ReservationMemoryRepository {
        <<repository>>
        -Map reservations
        -Map candidates
        +createWebReservationWithPaymentSession(dto) ReservationResult
        +approveOnlinePaymentAndAllocate(attemptId, actorId) AllocationResult
        +checkInReservation(id, actorId) CheckInResult
        +checkOutReservation(id, actorId) CheckOutResult
    }

    Reservation "1" *-- "1..3" ReservationCandidate : contains_candidates
    Reservation --> ReservationStatus : status
    Reservation --> ReservationSource : source
    ReservationCandidate --> CandidateRank : ranked_as

    AdminReservationService ..> Reservation : manages
    AdminReservationService ..> CandidateValidationService : validates_with
    AdminReservationService ..> ReservationStatusService : evaluates_with
    AdminReservationService ..> ReservationSessionService : inspects_with
    AdminReservationService --> AdminReservationRepository : uses

    AdminReservationRepository <|.. ReservationSupabaseRepository : implements
    AdminReservationRepository <|.. ReservationMemoryRepository : implements
```
