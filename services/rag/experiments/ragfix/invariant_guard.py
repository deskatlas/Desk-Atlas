"""PRD-F4/F6/F7/F9/F26: experimental narrow application-boundary critic."""
from typing import Literal
from pydantic import Field
from rag.document_support import Strict, Verification


class PaymentCommand(Strict):
    quote: str = Field(min_length=1, max_length=500)
    applies_to: Literal['EXPLICITLY_UNPAID_ONLY', 'PAID_OR_UNSPECIFIED']


class Guard(Strict):
    collect_payment_commands: list[PaymentCommand] = Field(max_length=12)
    account_required: bool
    staff_online_approval: bool
    inventory_held_before_confirmation: bool
    automatic_fourth_candidate: bool
    early_booking_qr_access: bool


PROMPT = '''Classify ONLY the candidate answer text, not whether its citations look convincing. Return JSON.
Extract EVERY imperative that tells the employee/customer to collect, pay, receive or take money. Do not count verifying payment status, reviewing an existing receipt, or explaining an admin approval. Copy each command exactly into quote. Classify EXPLICITLY_UNPAID_ONLY only if that SAME sentence or immediately governing conditional clause limits collection to a NEW UNPAID booking or a verified outstanding amount. A prior sentence asking whether a guest has a reservation, a heading about arrivals, "according to the approved procedure", "when applicable" without an amount-due condition, or a list of modes does NOT limit who is told to pay. Otherwise PAID_OR_UNSPECIFIED. A bare "Collect and verify payment" is PAID_OR_UNSPECIFIED even if another block mentions new bookings.
Then mark whether the answer requires a customer account to book, authorizes STAFF to approve online payment proof, promises inventory before authorized payment confirmation, automatically assigns an unapproved fourth candidate, or permits a booking QR before the booking window. Denials of these actions are not violations. Use role only for staff permissions. Never assume an unstated payment debt.'''


def guarding(generate):
    import asyncio
    async def call(prompt, data, schema):
        if 'answer' not in data:
            return await generate(prompt, data, schema)
        candidate = '\n\n'.join(block['text'] for block in data['answer']['blocks'])
        review, guard = await asyncio.gather(generate(prompt, data, schema),
            generate(PROMPT, {'candidate': candidate, 'role': data.get('authenticated_role', data.get('customer_principal'))}, Guard))
        if any(command.quote not in candidate for command in guard.collect_payment_commands):
            return Verification(relevant=False, supported=False, complete=False, consistent=False, safe=False)
        safe = not any(command.applies_to == 'PAID_OR_UNSPECIFIED' for command in guard.collect_payment_commands)
        safe = safe and not any(getattr(guard, key) for key in ('account_required', 'staff_online_approval',
            'inventory_held_before_confirmation', 'automatic_fourth_candidate', 'early_booking_qr_access'))
        return Verification(relevant=review.relevant, supported=review.supported,
            complete=review.complete, consistent=review.consistent, safe=review.safe and safe)
    return call
