import { expect, it } from 'vitest';
import { sourceBackedPaymentMethodOnly } from '../packages/domain/src/services/assistantDocumentSupport';

// PRD-F26 / SDD-C21 / QAD-TC44/46: method labels never relax QR access roles.
it('admits a source-backed literal payment method without forcing a whole-manual copy', () => {
  expect(sourceBackedPaymentMethodOnly('Choose Cash or QR Payment at the kiosk.', ['Choose Cash or QR Payment.'])).toBe(true);
});
it.each(['Scan QR Payment to enter.', 'QR Payment confirms your booking.', 'Use QR Payment as the booking QR.',
  'QR Payment is active only during your booking.', 'Choose QR Payment and scan it for check-in.', 'Choose QR Payment; it grants access.', 'Choose QR Payment. It grants access.'])(
  'keeps exact-source enforcement for QR roles: %s', text => {
    expect(sourceBackedPaymentMethodOnly(text, ['Choose Cash or QR Payment.'])).toBe(false);
  });
it('does not admit invented or differently identified QR methods', () => {
  expect(sourceBackedPaymentMethodOnly('Choose QR Payment.', ['Pay cash.'])).toBe(false);
  expect(sourceBackedPaymentMethodOnly('Use the payment QR.', ['Choose QR Payment.'])).toBe(false);
});
