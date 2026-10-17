// MS-47 / PRD-F13, QAD-TC23/45: client state is a projection of verified access.
export type Role = 'admin' | 'staff' | 'member' | null;
export type SessionUser = { id?: string; email?: string; role: Role; name?: string; token?: string; assistantToken?: string; isSuperAdmin?: boolean };
export const STORAGE_KEY = 'desk_atlas_user';
export type SessionState = {
  user: SessionUser | null; loading: boolean; isDeactivated: boolean;
  error: string; retryable: boolean; expiresAt: number | null; generation: number;
};
export const initialSession: SessionState = {
  user: null, loading: true, isDeactivated: false, error: '', retryable: false, expiresAt: null, generation: 0,
};
type SessionReply = { active?: boolean; user?: SessionUser; expiresAt?: number | null; error?: { code?: string } };
type SessionOptions = { endpoint: string; roles: Exclude<Role, null>[]; credential: (user: SessionUser) => string | undefined };
export class AdminSessionLifecycle {
  private state = initialSession;
  private candidate: SessionUser | null = null;
  private pending: { generation: number; promise: Promise<void> } | null = null;
  private listeners = new Set<() => void>();
  constructor(private transport: typeof fetch, private persist: (user: SessionUser | null) => void,
    private options: SessionOptions = { endpoint: '/api/admin/auth/session', roles: ['admin'], credential: user => user.token }) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(change: Partial<SessionState>) {
    this.state = { ...this.state, ...change }; this.listeners.forEach(listener => listener());
  }
  restore = (raw: string | null) => {
    let candidate: SessionUser | null = null;
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object' && 'role' in parsed && this.options.roles.includes(parsed.role as Exclude<Role, null>)) {
        const user = parsed as SessionUser;
        const token = this.options.credential(user);
        if (typeof token === 'string' && token.trim()) candidate = user;
      }
    } catch { /* Invalid local storage is not a session. */ }
    this.candidate = candidate;
    this.update({ ...initialSession, generation: this.state.generation + 1, loading: Boolean(candidate) });
    if (candidate) return this.check();
    this.persist(null);
    return Promise.resolve();
  };
  login = (candidate: SessionUser) => this.restore(JSON.stringify(candidate));
  logout = () => {
    this.candidate = null;
    this.update({ ...initialSession, loading: false, generation: this.state.generation + 1 });
    this.persist(null);
  };
  abandon = () => {
    this.candidate = null;
    this.update({ ...initialSession, generation: this.state.generation + 1 });
  };
  reject = (generation: number, code: string) => {
    if (generation !== this.state.generation || !this.candidate) return;
    if (code === 'AUTH_UNAVAILABLE') {
      this.update({ user: null, loading: true, retryable: true, generation: generation + 1, error: 'Unable to verify your session. Please retry.' });
    } else if (code === 'AUTH_REQUIRED' || code === 'ACCOUNT_INACTIVE' || code === 'ACCESS_REVOKED') {
      this.logout();
      this.update({ isDeactivated: code === 'ACCOUNT_INACTIVE', error: code === 'AUTH_REQUIRED'
        ? 'Your session ended. Sign in again.' : 'Administrator access denied.' });
    }
  };
  check = (): Promise<void> => {
    const candidate = this.candidate;
    const generation = this.state.generation;
    const credential = candidate ? this.options.credential(candidate) : undefined;
    if (!candidate || !credential) return Promise.resolve();
    if (this.pending?.generation === generation) return this.pending.promise;
    const promise = (async () => {
      try {
        const response = await this.transport(this.options.endpoint, {
          headers: { Authorization: `Bearer ${credential}` }, cache: 'no-store', signal: AbortSignal.timeout(12000),
        });
        const result: SessionReply = await response.json();
        if (generation !== this.state.generation) return;
        if (response.ok && result.active === true && result.user?.id && result.user.role
          && this.options.roles.includes(result.user.role)) {
          const user = { ...candidate, ...result.user, token: candidate.token };
          this.candidate = user;
          this.update({ user, loading: false, error: '', retryable: false, expiresAt: result.expiresAt ?? null });
          this.persist(user);
        } else if (response.status === 401) this.reject(generation, 'AUTH_REQUIRED');
        else if (response.status === 403) this.reject(generation, result.error?.code === 'ACCOUNT_INACTIVE' ? 'ACCOUNT_INACTIVE' : 'ACCESS_REVOKED');
        else this.reject(generation, 'AUTH_UNAVAILABLE');
      } catch {
        this.reject(generation, 'AUTH_UNAVAILABLE');
      }
    })().finally(() => {
      if (this.pending?.promise === promise) this.pending = null;
    });
    this.pending = { generation, promise };
    return promise;
  };
}
