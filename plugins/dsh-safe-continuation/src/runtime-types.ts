export interface SafeContinuationSessionHeader {
  readonly id: string;
  readonly cwd?: string;
  readonly origin?: 'subagent';
  readonly delegationDepth?: number;
  readonly agentPreset?: string;
}

export interface SafeContinuationSession {
  readonly id: string;
  readonly header?: SafeContinuationSessionHeader;
}

export interface SafeContinuationRequestContext {
  readonly provider: string;
  readonly model: string;
  readonly contextWindow?: number;
}

export interface SafeContinuationSessionEvent {
  readonly type: string;
  readonly seq: number;
  readonly time: number;
  readonly data: unknown;
  readonly ignorable?: true;
}

export interface SafeContinuationEnvelope {
  readonly session: SafeContinuationSession;
  readonly event: SafeContinuationSessionEvent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isSafeContinuationEnvelope(value: unknown): value is SafeContinuationEnvelope {
  if (!isRecord(value)) return false;
  if (!isRecord(value.session) || typeof value.session.id !== 'string') return false;
  if (!isRecord(value.event)) return false;
  if (typeof value.event.type !== 'string') return false;
  if (typeof value.event.seq !== 'number') return false;
  if (typeof value.event.time !== 'number') return false;
  if (!('data' in value.event)) return false;
  if (value.session.header !== undefined) {
    if (!isRecord(value.session.header) || typeof value.session.header.id !== 'string') return false;
  }
  return true;
}

export function isSafeContinuationRequestContext(value: unknown): value is SafeContinuationRequestContext {
  if (!isRecord(value)) return false;
  if (typeof value.provider !== 'string') return false;
  if (typeof value.model !== 'string') return false;
  if (value.contextWindow !== undefined && typeof value.contextWindow !== 'number') return false;
  return true;
}
