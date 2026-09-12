export interface StaffProfile {
  userId: string;
  email: string;
  role: 'ADMIN' | 'STAFF';
  displayName: string;
  isActive: boolean;
  isSuperAdmin?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminSetupStatus {
  hasAdmin: boolean;
  setupAllowed: boolean;
}

export interface AdminSetupInput {
  userId: string;
  email: string;
  displayName?: string;
  provider?: string;
}

export interface AdminSetupPasswordInput {
  userId: string;
  email: string;
  password: string;
  displayName?: string;
}

export class AdminAlreadyExistsError extends Error {
  readonly statusCode = 403;
  constructor(message: string = 'Administrator account already exists. Setup is sealed.') {
    super(message);
    this.name = 'AdminAlreadyExistsError';
  }
}

export class AdminSetupError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'AdminSetupError';
    this.statusCode = statusCode;
  }
}
