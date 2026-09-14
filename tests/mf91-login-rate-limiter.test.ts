import { describe, it, expect, beforeEach } from 'vitest';
import { LoginRateLimiter } from '@deskatlas/domain';

describe('MF-91: Login Rate Limiter (Admin & Staff)', () => {
  let limiter: LoginRateLimiter;

  beforeEach(() => {
    limiter = new LoginRateLimiter({
      maxAttempts: 3,
      lockoutDurationMs: 5 * 60 * 1000, // 5 minutes = 300 seconds
      attemptWindowMs: 15 * 60 * 1000,
    });
    limiter.reset();
  });

  it('allows initial login attempt with 3 attempts remaining', () => {
    const status = limiter.checkRateLimit('admin', 'admin@deskatlas.com', '127.0.0.1');
    expect(status.allowed).toBe(true);
    expect(status.remainingAttempts).toBe(3);
    expect(status.retryAfterSeconds).toBeUndefined();
  });

  it('correctly tracks attempt 1 and 2 without locking', () => {
    const now = 1000000;

    // Attempt 1 fails
    const fail1 = limiter.recordFailedAttempt('admin', 'admin@deskatlas.com', '127.0.0.1', now);
    expect(fail1.locked).toBe(false);
    expect(fail1.remainingAttempts).toBe(2);

    const check1 = limiter.checkRateLimit('admin', 'admin@deskatlas.com', '127.0.0.1', now + 1000);
    expect(check1.allowed).toBe(true);
    expect(check1.remainingAttempts).toBe(2);

    // Attempt 2 fails
    const fail2 = limiter.recordFailedAttempt('admin', 'admin@deskatlas.com', '127.0.0.1', now + 2000);
    expect(fail2.locked).toBe(false);
    expect(fail2.remainingAttempts).toBe(1);

    const check2 = limiter.checkRateLimit('admin', 'admin@deskatlas.com', '127.0.0.1', now + 3000);
    expect(check2.allowed).toBe(true);
    expect(check2.remainingAttempts).toBe(1);
  });

  it('triggers immediate 5-minute (300 seconds) lockout after the 3rd failed attempt', () => {
    const now = 1000000;

    limiter.recordFailedAttempt('admin', 'admin@deskatlas.com', '127.0.0.1', now);
    limiter.recordFailedAttempt('admin', 'admin@deskatlas.com', '127.0.0.1', now + 1000);

    // Attempt 3 fails
    const fail3 = limiter.recordFailedAttempt('admin', 'admin@deskatlas.com', '127.0.0.1', now + 2000);
    expect(fail3.locked).toBe(true);
    expect(fail3.remainingAttempts).toBe(0);
    expect(fail3.retryAfterSeconds).toBe(300); // 5 minutes
    expect(fail3.lockedUntil).toBe(now + 2000 + 300000);

    // Immediate check after 3rd attempt is locked
    const checkAfter3 = limiter.checkRateLimit('admin', 'admin@deskatlas.com', '127.0.0.1', now + 2000);
    expect(checkAfter3.allowed).toBe(false);
    expect(checkAfter3.remainingAttempts).toBe(0);
    expect(checkAfter3.retryAfterSeconds).toBe(300);
    expect(checkAfter3.lockedUntil).toBe(now + 2000 + 300000);
  });

  it('strictly blocks a 4th attempt while locked and computes real-time remaining seconds', () => {
    const now = 1000000;

    // 3 failed attempts
    limiter.recordFailedAttempt('staff', 'staff@deskatlas.com', '127.0.0.1', now);
    limiter.recordFailedAttempt('staff', 'staff@deskatlas.com', '127.0.0.1', now + 1000);
    limiter.recordFailedAttempt('staff', 'staff@deskatlas.com', '127.0.0.1', now + 2000);

    // 4th attempt 45 seconds later
    const check4 = limiter.checkRateLimit('staff', 'staff@deskatlas.com', '127.0.0.1', now + 47000);
    expect(check4.allowed).toBe(false);
    expect(check4.remainingAttempts).toBe(0);
    // (2000 + 300000) - 47000 = 255000 ms = 255 seconds
    expect(check4.retryAfterSeconds).toBe(255);
    expect(check4.lockedUntil).toBe(now + 302000);

    // Calling recordFailedAttempt while already locked preserves locked status
    const fail4 = limiter.recordFailedAttempt('staff', 'staff@deskatlas.com', '127.0.0.1', now + 47000);
    expect(fail4.locked).toBe(true);
    expect(fail4.retryAfterSeconds).toBe(255);
  });

  it('maintains isolation between admin and staff portals', () => {
    const now = 1000000;

    // Staff fails 3 times
    limiter.recordFailedAttempt('staff', 'user@deskatlas.com', '127.0.0.1', now);
    limiter.recordFailedAttempt('staff', 'user@deskatlas.com', '127.0.0.1', now + 1000);
    limiter.recordFailedAttempt('staff', 'user@deskatlas.com', '127.0.0.1', now + 2000);

    // Staff is locked
    const staffCheck = limiter.checkRateLimit('staff', 'user@deskatlas.com', '127.0.0.1', now + 3000);
    expect(staffCheck.allowed).toBe(false);

    // Admin with same email is NOT locked
    const adminCheck = limiter.checkRateLimit('admin', 'user@deskatlas.com', '127.0.0.1', now + 3000);
    expect(adminCheck.allowed).toBe(true);
    expect(adminCheck.remainingAttempts).toBe(3);
  });

  it('resets failed attempts upon successful login', () => {
    const now = 1000000;

    // 2 failed attempts
    limiter.recordFailedAttempt('admin', 'admin@deskatlas.com', '127.0.0.1', now);
    limiter.recordFailedAttempt('admin', 'admin@deskatlas.com', '127.0.0.1', now + 1000);
    expect(limiter.checkRateLimit('admin', 'admin@deskatlas.com', '127.0.0.1', now + 1500).remainingAttempts).toBe(1);

    // Successful login
    limiter.recordSuccessfulLogin('admin', 'admin@deskatlas.com', '127.0.0.1');

    // Fresh 3 attempts restored
    const status = limiter.checkRateLimit('admin', 'admin@deskatlas.com', '127.0.0.1', now + 2000);
    expect(status.allowed).toBe(true);
    expect(status.remainingAttempts).toBe(3);
  });

  it('unlocks after 5-minute lockout duration expires', () => {
    const now = 1000000;

    // 3 failed attempts
    limiter.recordFailedAttempt('staff', 'staff@deskatlas.com', '127.0.0.1', now);
    limiter.recordFailedAttempt('staff', 'staff@deskatlas.com', '127.0.0.1', now + 1000);
    limiter.recordFailedAttempt('staff', 'staff@deskatlas.com', '127.0.0.1', now + 2000);

    // Check at 301 seconds after lockout (lockout was at now + 2000 + 300000 = now + 302000)
    const afterExpiry = limiter.checkRateLimit('staff', 'staff@deskatlas.com', '127.0.0.1', now + 302001);
    expect(afterExpiry.allowed).toBe(true);
    expect(afterExpiry.remainingAttempts).toBe(3);
  });

  it('uses 5-minute default lockout in default LoginRateLimiter instance', () => {
    const defaultLimiter = new LoginRateLimiter();
    const now = 2000000;
    defaultLimiter.recordFailedAttempt('admin', 'test@example.com', '127.0.0.1', now);
    defaultLimiter.recordFailedAttempt('admin', 'test@example.com', '127.0.0.1', now + 100);
    const fail3 = defaultLimiter.recordFailedAttempt('admin', 'test@example.com', '127.0.0.1', now + 200);
    expect(fail3.locked).toBe(true);
    expect(fail3.retryAfterSeconds).toBe(300); // 5 minutes
    defaultLimiter.reset();
  });
});
