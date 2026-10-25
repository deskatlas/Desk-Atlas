// MS-84 / PRD-F13: deliberately allow only this canonical same-origin destination.
export const CLOSURE_REVIEW_DESTINATION = '/manage/reservations?filter=closure_impacted';
export function closureReturnDestination(value: string | null): string {
  return value === CLOSURE_REVIEW_DESTINATION ? value : '/manage';
}
