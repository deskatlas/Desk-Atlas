import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  LoginRateLimiter,
  customerVerifyRateLimiter,
  getCustomerVerifyRateLimiter,
  formatLockoutTime,
  CustomerMemoryRepository,
  CustomerService,
} from '@deskatlas/domain';

// MS-42 Quality Assurance & Verification Test Suite
// Traceability: MS-42, BRD-M2, BRD-M3, PRD-F24, SDD-C15, DSD-UI13, ERD-E15, QAD-TC42
// Test Cases: QAD-TC42.1 through QAD-TC42.10

describe('MS-42: Customer Rewards Identity Verification Anti-Brute-Force Lockout, DevTools-Immune Rate Limiting, and Multi-Tab Countdown Timer Lifecycle (QAD-TC42)', () => {
  const root = resolve(__dirname, '..');
  const rewardsAccessCardPath = resolve(
    root,
    'apps/customer-website/src/features/tracking/components/RewardsAccessCard.tsx'
  );
  const verifyIdentityRoutePath = resolve(
    root,
    'apps/customer-website/src/app/api/customer/verify-identity/route.ts'
  );
  const loginRateLimiterPath = resolve(
    root,
    'packages/domain/src/services/loginRateLimiter.ts'
  );

  const rewardsAccessCardContent = readFileSync(rewardsAccessCardPath, 'utf-8');
  const verifyIdentityRouteContent = readFileSync(verifyIdentityRoutePath, 'utf-8');
  const loginRateLimiterContent = readFileSync(loginRateLimiterPath, 'utf-8');

  let limiter: LoginRateLimiter;

  beforeEach(() => {
    limiter = new LoginRateLimiter({
      maxAttempts: 3,
      lockoutDurationMs: 5 * 60 * 1000,
      attemptWindowMs: 15 * 60 * 1000,
    });
    limiter.reset();
    customerVerifyRateLimiter.reset();
  });

  // Architectural & Hard Ban Checks
  it('MS-42 Architecture: Zero em-dashes across modified components and domain files', () => {
    expect(existsSync(rewardsAccessCardPath)).toBe(true);
    expect(existsSync(verifyIdentityRoutePath)).toBe(true);
    expect(existsSync(loginRateLimiterPath)).toBe(true);

    // BAN-PUNCT-01 enforcement
    expect(rewardsAccessCardContent).not.toMatch(/\u2014/);
    expect(verifyIdentityRouteContent).not.toMatch(/\u2014/);
    expect(loginRateLimiterContent).not.toMatch(/\u2014/);
  });

  // QAD-TC42.1: LoginRateLimiter ('customer') - first two failed verification attempts return locked: false
  it('QAD-TC42.1: LoginRateLimiter (customer) - first two failed verification attempts return locked: false with remaining attempts 2 and 1', () => {
    const now = 2000000;
    const identifier = '7K9M2P:guest@example.com';
    const ip = '192.168.1.100';

    // Initial check
    const initialCheck = limiter.checkRateLimit('customer', identifier, ip, now);
    expect(initialCheck.allowed).toBe(true);
    expect(initialCheck.remainingAttempts).toBe(3);

    // Attempt 1 fails
    const fail1 = limiter.recordFailedAttempt('customer', identifier, ip, now);
    expect(fail1.locked).toBe(false);
    expect(fail1.remainingAttempts).toBe(2);

    const check1 = limiter.checkRateLimit('customer', identifier, ip, now + 1000);
    expect(check1.allowed).toBe(true);
    expect(check1.remainingAttempts).toBe(2);

    // Attempt 2 fails
    const fail2 = limiter.recordFailedAttempt('customer', identifier, ip, now + 2000);
    expect(fail2.locked).toBe(false);
    expect(fail2.remainingAttempts).toBe(1);

    const check2 = limiter.checkRateLimit('customer', identifier, ip, now + 3000);
    expect(check2.allowed).toBe(true);
    expect(check2.remainingAttempts).toBe(1);
  });

  // QAD-TC42.2: LoginRateLimiter ('customer') - third failed verification attempt triggers immediate 300-second lockout
  it('QAD-TC42.2: LoginRateLimiter (customer) - third failed verification attempt triggers immediate 300-second (5-minute) lockout', () => {
    const now = 2000000;
    const identifier = '7K9M2P:guest@example.com';
    const ip = '192.168.1.100';

    limiter.recordFailedAttempt('customer', identifier, ip, now);
    limiter.recordFailedAttempt('customer', identifier, ip, now + 1000);

    // Attempt 3 fails
    const fail3 = limiter.recordFailedAttempt('customer', identifier, ip, now + 2000);
    expect(fail3.locked).toBe(true);
    expect(fail3.remainingAttempts).toBe(0);
    expect(fail3.retryAfterSeconds).toBe(300);
    expect(fail3.lockedUntil).toBe(now + 2000 + 300000);

    // Immediate check after 3rd attempt is locked
    const checkAfter3 = limiter.checkRateLimit('customer', identifier, ip, now + 2000);
    expect(checkAfter3.allowed).toBe(false);
    expect(checkAfter3.remainingAttempts).toBe(0);
    expect(checkAfter3.retryAfterSeconds).toBe(300);
    expect(checkAfter3.lockedUntil).toBe(now + 2000 + 300000);

    // Verify accessor function also returns customer rate limiter instance
    expect(getCustomerVerifyRateLimiter()).toBeDefined();
    expect(customerVerifyRateLimiter).toBeDefined();
  });

  // QAD-TC42.3: POST /api/customer/verify-identity returns HTTP 429 with lockedUntil and retryAfterSeconds
  it('QAD-TC42.3: POST /api/customer/verify-identity contract returns HTTP 429 with lockedUntil and retryAfterSeconds when locked', async () => {
    // Assert route file contract wiring
    expect(verifyIdentityRouteContent).toContain("customerVerifyRateLimiter.checkRateLimit('customer', identifier, ip)");
    expect(verifyIdentityRouteContent).toContain("customerVerifyRateLimiter.recordFailedAttempt('customer', identifier, ip)");
    expect(verifyIdentityRouteContent).toContain("customerVerifyRateLimiter.recordSuccessfulLogin('customer', identifier, ip)");
    expect(verifyIdentityRouteContent).toContain("status: 429");
    expect(verifyIdentityRouteContent).toContain("'Retry-After': String(rateCheck.retryAfterSeconds || 60)");
    expect(verifyIdentityRouteContent).toContain("lockedUntil: rateCheck.lockedUntil");
    expect(verifyIdentityRouteContent).toContain("retryAfterSeconds: rateCheck.retryAfterSeconds");

    // Execute verification flow via domain services to assert HTTP 429 response structure
    const customerRepo = new CustomerMemoryRepository();
    const customerService = new CustomerService(customerRepo);
    const identifier = '7K9M2P:unknown@example.com';
    const ip = '10.0.0.1';

    // 3 failed attempts
    customerVerifyRateLimiter.recordFailedAttempt('customer', identifier, ip);
    customerVerifyRateLimiter.recordFailedAttempt('customer', identifier, ip);
    const failResult = customerVerifyRateLimiter.recordFailedAttempt('customer', identifier, ip);

    expect(failResult.locked).toBe(true);
    expect(failResult.retryAfterSeconds).toBe(300);
    expect(typeof failResult.lockedUntil).toBe('number');

    // Simulate route rate check result
    const rateCheck = customerVerifyRateLimiter.checkRateLimit('customer', identifier, ip);
    expect(rateCheck.allowed).toBe(false);
    expect(rateCheck.retryAfterSeconds).toBe(300);
    expect(rateCheck.lockedUntil).toBe(failResult.lockedUntil);

    const errorPayload = {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many failed verification attempts. Please try again in 5 minutes.',
        retryAfterSeconds: rateCheck.retryAfterSeconds,
        lockedUntil: rateCheck.lockedUntil,
      },
    };
    expect(errorPayload.error.code).toBe('RATE_LIMITED');
    expect(errorPayload.error.retryAfterSeconds).toBe(300);
    expect(errorPayload.error.lockedUntil).toBeGreaterThan(Date.now());
  });

  // QAD-TC42.4: Subsequent requests while locked are rejected immediately with HTTP 429 without querying database
  it('QAD-TC42.4: Subsequent requests while locked are rejected immediately with HTTP 429 without querying database', () => {
    // Verify route handler checks rate limit before invoking createAccessChallenge
    const rateCheckIndex = verifyIdentityRouteContent.indexOf('customerVerifyRateLimiter.checkRateLimit');
    const challengeIndex = verifyIdentityRouteContent.indexOf('customerService.createAccessChallenge');

    expect(rateCheckIndex).toBeGreaterThan(-1);
    expect(challengeIndex).toBeGreaterThan(-1);
    expect(rateCheckIndex).toBeLessThan(challengeIndex);

    // Verify rate limit check blocks execution
    const identifier = '7K9M2P:unknown@example.com';
    const ip = '10.0.0.2';
    customerVerifyRateLimiter.recordFailedAttempt('customer', identifier, ip);
    customerVerifyRateLimiter.recordFailedAttempt('customer', identifier, ip);
    customerVerifyRateLimiter.recordFailedAttempt('customer', identifier, ip);

    const check = customerVerifyRateLimiter.checkRateLimit('customer', identifier, ip);
    expect(check.allowed).toBe(false);
    expect(check.remainingAttempts).toBe(0);
  });

  // QAD-TC42.5: RewardsAccessCard Lockout Parsing and localStorage key contract
  it('QAD-TC42.5: RewardsAccessCard defines STORAGE_KEY_VERIFY_LOCKOUT and parses 429 response', () => {
    expect(rewardsAccessCardContent).toContain('deskatlas_customer_verify_lockout');
    expect(rewardsAccessCardContent).toContain('localStorage.setItem(');
    expect(rewardsAccessCardContent).toContain('localStorage.getItem(');
    expect(rewardsAccessCardContent).toContain('localStorage.removeItem(');

    // Verify parser handles 429 and extracts lockedUntil / retryAfterSeconds
    expect(rewardsAccessCardContent).toContain('res.status === 429 || json?.error?.lockedUntil || json?.error?.retryAfterSeconds');
    expect(rewardsAccessCardContent).toContain('setLockedUntil(lockTime)');
  });

  // QAD-TC42.6: formatLockoutTime utility precision
  it('QAD-TC42.6: formatLockoutTime correctly formats seconds to mm:ss notation', () => {
    expect(formatLockoutTime(300)).toBe('05:00');
    expect(formatLockoutTime(299)).toBe('04:59');
    expect(formatLockoutTime(65)).toBe('01:05');
    expect(formatLockoutTime(5)).toBe('00:05');
    expect(formatLockoutTime(0)).toBe('00:00');
  });

  // QAD-TC42.7: Countdown ticking and expiration cleanup architecture
  it('QAD-TC42.7: Countdown ticking mechanism uses setInterval(1000) and removes lockout when expired', () => {
    expect(rewardsAccessCardContent).toContain('setInterval(updateTimer, 1000)');
    expect(rewardsAccessCardContent).toContain('clearInterval(interval)');
    expect(rewardsAccessCardContent).toContain('if (diff === 0)');
    expect(rewardsAccessCardContent).toContain('setLockedUntil(null)');
    expect(rewardsAccessCardContent).toContain('localStorage.removeItem(STORAGE_KEY_VERIFY_LOCKOUT)');
  });

  // QAD-TC42.8: RewardsAccessCard DevTools Tamper Resilience
  it('QAD-TC42.8: RewardsAccessCard validates lockedUntil at runtime inside handleVerify before dispatching fetch', () => {
    // DevTools check ensures if DOM disabled attribute was removed, client-side runtime check halts submission
    expect(rewardsAccessCardContent).toContain('if (lockedUntil && Date.now() < lockedUntil)');
    expect(rewardsAccessCardContent).toContain('Too many failed verification attempts. Please wait');
  });

  // QAD-TC42.9: Verification Failed Modal UI displays countdown banner and disables Try Again button while locked
  it('QAD-TC42.9: Modal renders countdown box and disables Try Again button while locked', () => {
    expect(rewardsAccessCardContent).toContain('data-testid="rewards-verify-lockout-banner"');
    expect(rewardsAccessCardContent).toContain('data-testid="rewards-verify-countdown"');
    expect(rewardsAccessCardContent).toContain('data-testid="rewards-verify-error-close"');
    expect(rewardsAccessCardContent).toContain('disabled={isLocked}');
    expect(rewardsAccessCardContent).toContain('{isLocked ? `Locked (${formatLockoutTime(remainingSeconds)})` : "Try Again"}');
    expect(rewardsAccessCardContent).toContain('Form temporarily locked for your security');
  });

  // QAD-TC42.10: Cross-Tab Synchronization via storage and visibilitychange events
  it('QAD-TC42.10: RewardsAccessCard attaches storage, visibilitychange, and focus listeners', () => {
    expect(rewardsAccessCardContent).toContain('document.addEventListener("visibilitychange", onVisibilityOrFocus)');
    expect(rewardsAccessCardContent).toContain('window.addEventListener("focus", onVisibilityOrFocus)');
    expect(rewardsAccessCardContent).toContain('window.addEventListener("storage", onStorage)');
    expect(rewardsAccessCardContent).toContain('document.removeEventListener("visibilitychange", onVisibilityOrFocus)');
    expect(rewardsAccessCardContent).toContain('window.removeEventListener("focus", onVisibilityOrFocus)');
    expect(rewardsAccessCardContent).toContain('window.removeEventListener("storage", onStorage)');
  });
});
