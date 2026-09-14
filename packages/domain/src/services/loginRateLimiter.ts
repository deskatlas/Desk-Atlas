export interface RateLimitCheckResult {
  allowed: boolean;
  remainingAttempts: number;
  retryAfterSeconds?: number;
  lockedUntil?: number;
}

export interface RateLimitFailResult {
  locked: boolean;
  remainingAttempts: number;
  retryAfterSeconds?: number;
  lockedUntil?: number;
}

export interface RateLimitEntry {
  failedAttempts: number;
  lockedUntil: number | null;
  firstAttemptAt: number;
}

export interface LoginRateLimiterOptions {
  maxAttempts?: number;
  lockoutDurationMs?: number;
  attemptWindowMs?: number;
}

export class LoginRateLimiter {
  private readonly maxAttempts: number;
  private readonly lockoutDurationMs: number;
  private readonly attemptWindowMs: number;
  private readonly map: Map<string, RateLimitEntry>;

  constructor(options?: LoginRateLimiterOptions) {
    this.maxAttempts = options?.maxAttempts ?? 3;
    this.lockoutDurationMs = options?.lockoutDurationMs ?? 5 * 60 * 1000; // 5 minutes
    this.attemptWindowMs = options?.attemptWindowMs ?? 15 * 60 * 1000; // 15 minutes

    const globalStore = globalThis as unknown as {
      __deskAtlasLoginRateLimitMap?: Map<string, RateLimitEntry>;
    };

    if (!globalStore.__deskAtlasLoginRateLimitMap) {
      globalStore.__deskAtlasLoginRateLimitMap = new Map<string, RateLimitEntry>();
    }

    this.map = globalStore.__deskAtlasLoginRateLimitMap;
  }

  private buildKey(portal: 'admin' | 'staff', identifier: string, ip?: string): string {
    const cleanId = (identifier || '').trim().toLowerCase();
    const cleanIp = (ip || '').trim().toLowerCase();
    if (cleanId) {
      return `${portal}:email:${cleanId}`;
    }
    return `${portal}:ip:${cleanIp || 'unknown'}`;
  }

  public checkRateLimit(
    portal: 'admin' | 'staff',
    identifier: string,
    ip?: string,
    now: number = Date.now()
  ): RateLimitCheckResult {
    const key = this.buildKey(portal, identifier, ip);
    const entry = this.map.get(key);

    if (!entry) {
      return {
        allowed: true,
        remainingAttempts: this.maxAttempts,
      };
    }

    // If currently locked
    if (entry.lockedUntil && now < entry.lockedUntil) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000));
      return {
        allowed: false,
        remainingAttempts: 0,
        retryAfterSeconds,
        lockedUntil: entry.lockedUntil,
      };
    }

    // If lockout has elapsed, clear lockout and reset counter
    if (entry.lockedUntil && now >= entry.lockedUntil) {
      this.map.delete(key);
      return {
        allowed: true,
        remainingAttempts: this.maxAttempts,
      };
    }

    // Check sliding attempt window expiry
    if (now - entry.firstAttemptAt > this.attemptWindowMs) {
      this.map.delete(key);
      return {
        allowed: true,
        remainingAttempts: this.maxAttempts,
      };
    }

    const remainingAttempts = Math.max(0, this.maxAttempts - entry.failedAttempts);
    return {
      allowed: remainingAttempts > 0,
      remainingAttempts,
    };
  }

  public recordFailedAttempt(
    portal: 'admin' | 'staff',
    identifier: string,
    ip?: string,
    now: number = Date.now()
  ): RateLimitFailResult {
    const key = this.buildKey(portal, identifier, ip);
    let entry = this.map.get(key);

    if (!entry || now - entry.firstAttemptAt > this.attemptWindowMs) {
      entry = {
        failedAttempts: 1,
        lockedUntil: null,
        firstAttemptAt: now,
      };
      this.map.set(key, entry);
      return {
        locked: false,
        remainingAttempts: this.maxAttempts - 1,
      };
    }

    // If already locked, update and return lock info
    if (entry.lockedUntil && now < entry.lockedUntil) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000));
      return {
        locked: true,
        remainingAttempts: 0,
        retryAfterSeconds,
        lockedUntil: entry.lockedUntil,
      };
    }

    // Increment failed attempts
    entry.failedAttempts += 1;

    if (entry.failedAttempts >= this.maxAttempts) {
      entry.lockedUntil = now + this.lockoutDurationMs;
      const retryAfterSeconds = Math.ceil(this.lockoutDurationMs / 1000);
      return {
        locked: true,
        remainingAttempts: 0,
        retryAfterSeconds,
        lockedUntil: entry.lockedUntil,
      };
    }

    const remainingAttempts = Math.max(0, this.maxAttempts - entry.failedAttempts);
    return {
      locked: false,
      remainingAttempts,
    };
  }

  public recordSuccessfulLogin(portal: 'admin' | 'staff', identifier: string, ip?: string): void {
    const key = this.buildKey(portal, identifier, ip);
    this.map.delete(key);
  }

  public reset(portal?: 'admin' | 'staff', identifier?: string, ip?: string): void {
    if (portal && (identifier || ip)) {
      const key = this.buildKey(portal, identifier || '', ip);
      this.map.delete(key);
    } else {
      this.map.clear();
    }
  }

  public getStatus(portal: 'admin' | 'staff', identifier: string, ip?: string, now: number = Date.now()) {
    return this.checkRateLimit(portal, identifier, ip, now);
  }
}

export const loginRateLimiter = new LoginRateLimiter();
