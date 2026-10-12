import { createHmac } from 'crypto';
import type { RateLimitScope } from '../models/customer';
import type { CustomerRepository } from './customerRepository';

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMIT_RULES: Record<RateLimitScope, RateLimitRule> = {
  VERIFY_IP: { limit: 5, windowSeconds: 15 * 60 },
  VERIFY_EMAIL: { limit: 5, windowSeconds: 15 * 60 },
  CUSTOMER_TOKEN: { limit: 60, windowSeconds: 60 },
  PROMO_IP: { limit: 10, windowSeconds: 60 },
  PROMO_EMAIL: { limit: 10, windowSeconds: 60 },
  EMAIL_CUSTOMER: { limit: 10, windowSeconds: 60 * 60 },
  EMAIL_VOUCHER: { limit: 1, windowSeconds: 5 * 60 },
};

export class RateLimitedError extends Error {
  constructor(public readonly retryAfterSeconds: number, message: string = 'Too many attempts. Please try again later.') {
    super(message);
    this.name = 'RateLimitedError';
  }
}

export class RateLimiterService {
  private secret: string;

  constructor(
    private readonly repository: CustomerRepository,
    secret?: string
  ) {
    this.secret = secret || process.env.REWARDS_RATE_LIMIT_SECRET || 'deskatlas_rewards_rate_limit_secret_default_key';
  }

  hashSubject(rawSubject: string): string {
    return createHmac('sha256', this.secret).update(rawSubject.trim().toLowerCase()).digest('hex');
  }

  async checkAndRecord(
    scope: RateLimitScope,
    rawSubject: string,
    requestId?: string | null
  ): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
    const subjectHash = this.hashSubject(rawSubject);
    const rule = RATE_LIMIT_RULES[scope];

    const currentCount = await this.repository.countRateLimitEvents(
      scope,
      subjectHash,
      rule.windowSeconds
    );

    if (currentCount >= rule.limit) {
      const oldest = await this.repository.getOldestRateLimitEventInWindow(
        scope,
        subjectHash,
        rule.windowSeconds
      );

      let retryAfter = rule.windowSeconds;
      if (oldest) {
        const elapsed = Math.floor((Date.now() - new Date(oldest.createdAt).getTime()) / 1000);
        retryAfter = Math.max(1, rule.windowSeconds - elapsed);
      }

      return { allowed: false, retryAfterSeconds: retryAfter };
    }

    // Record this attempt
    await this.repository.recordRateLimitEvent(scope, subjectHash, requestId);
    return { allowed: true };
  }

  async assertAllowed(
    scope: RateLimitScope,
    rawSubject: string,
    requestId?: string | null
  ): Promise<void> {
    const result = await this.checkAndRecord(scope, rawSubject, requestId);
    if (!result.allowed) {
      throw new RateLimitedError(result.retryAfterSeconds || 60);
    }
  }
}
