/**
 * @flowmind/shared-types
 * Core shared types, enums, and DTO shapes for FlowMind AI (MVP).
 * Used by desktop, web, api, and worker. Keep minimal and stable.
 */

// Roles (per-client)
export type Role = 'CLIENT_ADMIN' | 'REVIEWER' | 'CONTRIBUTOR' | 'VIEWER';

export const ROLES: Role[] = ['CLIENT_ADMIN', 'REVIEWER', 'CONTRIBUTOR', 'VIEWER'];

// Basic permissions (MVP set)
export type Permission =
  | 'RECORD_WORKFLOW'
  | 'VIEW_SESSIONS'
  | 'REVIEW_SOP'
  | 'MANAGE_USERS'
  | 'MANAGE_POLICY'
  | 'VIEW_AUDIT';

export const PERMISSIONS: Record<Role, Permission[]> = {
  CLIENT_ADMIN: ['RECORD_WORKFLOW', 'VIEW_SESSIONS', 'REVIEW_SOP', 'MANAGE_USERS', 'MANAGE_POLICY', 'VIEW_AUDIT'],
  REVIEWER: ['VIEW_SESSIONS', 'REVIEW_SOP', 'VIEW_AUDIT'],
  CONTRIBUTOR: ['RECORD_WORKFLOW', 'VIEW_SESSIONS'],
  VIEWER: ['VIEW_SESSIONS'],
};

// Event types for agent capture (hybrid event-driven)
export type EventType =
  | 'SESSION_START'
  | 'SESSION_PAUSE'
  | 'SESSION_RESUME'
  | 'SESSION_STOP'
  | 'APP_CHANGED'
  | 'WINDOW_CHANGED'
  | 'MOUSE_CLICK'
  | 'KEY_ACTION' // Only safe categories: TAB_NAVIGATION, ENTER_SUBMIT, ESC_CANCEL, SHORTCUT
  | 'SCREEN_DELTA'
  | 'USER_NOTE'
  | 'FALLBACK_TICK'; // time fallback only, rare

export interface CapturedEvent {
  localEventId: string;
  sequenceNo: number;
  eventType: EventType;
  timestamp: string; // ISO
  appName?: string;
  windowTitle?: string;
  metadata?: Record<string, any>; // safe metadata only. NO raw keystrokes, passwords, or form content.
  note?: string; // for USER_NOTE
}

// Session lifecycle
export type SessionStatus = 'CREATED' | 'RECORDING' | 'PAUSED' | 'STOPPED' | 'PROCESSING' | 'READY';

export interface Session {
  id: string;
  clientId: string;
  userId: string;
  status: SessionStatus;
  startedAt: string;
  endedAt?: string;
  agentVersion?: string;
}

// For uploads
export interface EventBatchPayload {
  sessionId: string;
  idempotencyKey?: string;
  events: CapturedEvent[];
}

export interface ArtifactUploadConfirm {
  sessionId: string;
  eventId?: string;
  storageKey: string;
  artifactType: 'screenshot' | 'note' | 'other';
  sizeBytes: number;
  hash?: string;
}

// SOP / Workflow (drafts)
export type SopStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'ARCHIVED';

export interface WorkflowStep {
  stepNo: number;
  title: string;
  description: string;
  eventRefs?: string[];
  artifactRefs?: string[];
}

export interface SopDocument {
  id: string;
  workflowId: string;
  title: string;
  status: SopStatus;
  currentVersionId?: string;
  contentMarkdown?: string;
  contentJson?: any;
}

// Audit action types (sensitive)
export type AuditAction =
  | 'LOGIN'
  | 'SESSION_START'
  | 'SESSION_PAUSE'
  | 'SESSION_STOP'
  | 'UPLOAD_COMPLETE'
  | 'SOP_GENERATED'
  | 'SOP_APPROVED'
  | 'SOP_REJECTED'
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'ROLE_CHANGED'
  | 'POLICY_UPDATED'
  | 'DATA_EXPORT'
  | 'DATA_DELETE';

// Access scope passed down after guards (critical for isolation)
export interface AccessScope {
  actorUserId: string;
  clientId: string;
  role: Role;
  permissions: Permission[];
  // These are resolved and validated:
  clientDbUrl?: string; // or actual PrismaClient instance injected
  storageBucket?: string;
  vectorNamespace?: string;
  aiConfig?: Record<string, any>;
}

// JWT payload shape (claims important for resolver)
export interface JwtPayload {
  sub: string; // user id
  client_id: string; // MUST match the resolved client from host/subdomain/header
  email: string;
  role: Role;
  permissions: Permission[];
  iat?: number;
  exp?: number;
}

// API error shape (standardized)
export interface ApiError {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: any;
  };
}
