import {
  AdminAlreadyExistsError,
  AdminSetupError,
  AdminSetupInput,
  AdminSetupStatus,
  StaffProfile,
} from '../models/staffProfile';

export interface StaffRepository {
  hasAdmin(): Promise<boolean>;
  bootstrapInitialAdmin(input: AdminSetupInput): Promise<StaffProfile>;
  getProfileByUserId(userId: string): Promise<StaffProfile | null>;
}

export class InMemoryStaffRepository implements StaffRepository {
  private profiles: Map<string, StaffProfile> = new Map();

  constructor(initialProfiles: StaffProfile[] = []) {
    for (const p of initialProfiles) {
      this.profiles.set(p.userId, { ...p });
    }
  }

  async hasAdmin(): Promise<boolean> {
    for (const p of this.profiles.values()) {
      if (p.role === 'ADMIN' && p.isActive) {
        return true;
      }
    }
    return false;
  }

  async bootstrapInitialAdmin(input: AdminSetupInput): Promise<StaffProfile> {
    const adminExists = await this.hasAdmin();
    if (adminExists) {
      throw new AdminAlreadyExistsError('Administrator account already exists. Setup is sealed.');
    }

    const now = new Date().toISOString();
    const profile: StaffProfile = {
      userId: input.userId,
      email: input.email.toLowerCase().trim(),
      displayName: input.displayName?.trim() || input.email.split('@')[0] || 'Admin',
      role: 'ADMIN',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    this.profiles.set(profile.userId, profile);
    return profile;
  }

  async getProfileByUserId(userId: string): Promise<StaffProfile | null> {
    const p = this.profiles.get(userId);
    return p ? { ...p } : null;
  }

  // Test helper
  clear() {
    this.profiles.clear();
  }
}

export class SupabaseStaffRepository implements StaffRepository {
  private readonly supabaseUrl: string;
  private readonly serviceRoleKey: string;

  constructor(options?: { supabaseUrl?: string; serviceRoleKey?: string }) {
    this.supabaseUrl = (
      options?.supabaseUrl ||
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      ''
    ).replace(/\/$/, '');
    this.serviceRoleKey =
      options?.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  }

  async hasAdmin(): Promise<boolean> {
    if (!this.supabaseUrl || !this.serviceRoleKey) {
      return false;
    }

    try {
      // Try RPC first
      const rpcRes = await fetch(`${this.supabaseUrl}/rest/v1/rpc/admin_has_existing_admin`, {
        method: 'POST',
        headers: {
          apikey: this.serviceRoleKey,
          Authorization: `Bearer ${this.serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      });

      if (rpcRes.ok) {
        const result = await rpcRes.json();
        return Boolean(result);
      }
    } catch {
      // fallback to REST table query
    }

    try {
      const res = await fetch(
        `${this.supabaseUrl}/rest/v1/staff_profiles?role=eq.ADMIN&is_active=eq.true&select=user_id&limit=1`,
        {
          headers: {
            apikey: this.serviceRoleKey,
            Authorization: `Bearer ${this.serviceRoleKey}`,
          },
          cache: 'no-store',
        }
      );

      if (res.ok) {
        const rows = await res.json();
        return Array.isArray(rows) && rows.length > 0;
      }
    } catch {
      // ignore
    }

    return false;
  }

  async bootstrapInitialAdmin(input: AdminSetupInput): Promise<StaffProfile> {
    if (!this.supabaseUrl || !this.serviceRoleKey) {
      throw new AdminSetupError('Supabase configuration missing', 500);
    }

    // Try RPC first
    try {
      const rpcRes = await fetch(`${this.supabaseUrl}/rest/v1/rpc/admin_bootstrap_initial_admin`, {
        method: 'POST',
        headers: {
          apikey: this.serviceRoleKey,
          Authorization: `Bearer ${this.serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_user_id: input.userId,
          p_email: input.email.toLowerCase().trim(),
          p_display_name: input.displayName?.trim() || null,
        }),
      });

      if (rpcRes.ok) {
        const rows = await rpcRes.json();
        if (Array.isArray(rows) && rows.length > 0) {
          const row = rows[0];
          return {
            userId: row.id,
            email: row.email,
            role: 'ADMIN',
            displayName: row.display_name,
            isActive: Boolean(row.is_active),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          };
        }
      } else {
        const errText = await rpcRes.text();
        if (errText.includes('already exists') || errText.includes('sealed')) {
          throw new AdminAlreadyExistsError('Administrator account already exists. Setup is sealed.');
        }
      }
    } catch (e: any) {
      if (e instanceof AdminAlreadyExistsError) throw e;
    }

    // Fallback: Check and insert directly
    const alreadyExists = await this.hasAdmin();
    if (alreadyExists) {
      throw new AdminAlreadyExistsError('Administrator account already exists. Setup is sealed.');
    }

    const trimmedEmail = input.email.toLowerCase().trim();
    const displayName = input.displayName?.trim() || trimmedEmail.split('@')[0] || 'Admin';

    const insertRes = await fetch(`${this.supabaseUrl}/rest/v1/staff_profiles`, {
      method: 'POST',
      headers: {
        apikey: this.serviceRoleKey,
        Authorization: `Bearer ${this.serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        user_id: input.userId,
        role: 'ADMIN',
        display_name: displayName,
        is_active: true,
      }),
    });

    if (!insertRes.ok) {
      const errDetail = await insertRes.text();
      if (insertRes.status === 409 || errDetail.includes('already exists')) {
        throw new AdminAlreadyExistsError('Administrator account already exists. Setup is sealed.');
      }
      throw new AdminSetupError(`Failed to save admin profile: ${errDetail}`, insertRes.status);
    }

    const insertedRows = await insertRes.json();
    const row = insertedRows[0];
    return {
      userId: row.user_id,
      email: trimmedEmail,
      role: 'ADMIN',
      displayName: row.display_name,
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async getProfileByUserId(userId: string): Promise<StaffProfile | null> {
    if (!this.supabaseUrl || !this.serviceRoleKey || !userId) {
      return null;
    }

    try {
      const res = await fetch(
        `${this.supabaseUrl}/rest/v1/staff_profiles?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`,
        {
          headers: {
            apikey: this.serviceRoleKey,
            Authorization: `Bearer ${this.serviceRoleKey}`,
          },
          cache: 'no-store',
        }
      );

      if (!res.ok) return null;
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) return null;

      const p = rows[0];
      return {
        userId: p.user_id,
        email: p.email || '',
        role: (String(p.role || '').toUpperCase() as 'ADMIN' | 'STAFF') || 'STAFF',
        displayName: p.display_name,
        isActive: Boolean(p.is_active),
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      };
    } catch {
      return null;
    }
  }
}

export class StaffService {
  constructor(private readonly repository: StaffRepository) {}

  async checkAdminExists(): Promise<boolean> {
    return this.repository.hasAdmin();
  }

  async getSetupStatus(): Promise<AdminSetupStatus> {
    const hasAdmin = await this.repository.hasAdmin();
    return {
      hasAdmin,
      setupAllowed: !hasAdmin,
    };
  }

  async setupInitialAdmin(input: AdminSetupInput): Promise<StaffProfile> {
    if (!input.userId || !input.userId.trim()) {
      throw new AdminSetupError('User ID is required for admin initialization', 400);
    }

    const email = input.email ? input.email.trim().toLowerCase() : '';
    if (!email || !email.includes('@') || email.length < 5) {
      throw new AdminSetupError('A valid email address is required', 400);
    }

    // Single-use guard
    const exists = await this.repository.hasAdmin();
    if (exists) {
      throw new AdminAlreadyExistsError('Administrator account already exists. Setup is sealed.');
    }

    return this.repository.bootstrapInitialAdmin({
      ...input,
      email,
      displayName: input.displayName?.trim(),
    });
  }

  async getProfile(userId: string): Promise<StaffProfile | null> {
    if (!userId || !userId.trim()) return null;
    return this.repository.getProfileByUserId(userId.trim());
  }
}

export function createStaffService(repository?: StaffRepository): StaffService {
  return new StaffService(repository || new SupabaseStaffRepository());
}
