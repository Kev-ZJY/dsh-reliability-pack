import type { ContinuationConfig } from './config.ts';

export interface ContinuationObservation {
  finishKind: string;
  hasToolActivity: boolean;
  approvalPending: boolean;
  queuedInput: boolean;
  aborted: boolean;
  turnKey: string;
  turnCount: number;
  sessionCount: number;
}

export interface ContinuationDecision {
  continue: boolean;
  reason: string;
}

function invalidLimit(value: number): boolean {
  return !Number.isFinite(value) || !Number.isInteger(value) || value < 1;
}

export function decideContinuation(
  config: ContinuationConfig,
  observation: ContinuationObservation,
): ContinuationDecision {
  if (!config.enabled) {
    return { continue: false, reason: 'disabled' };
  }
  if (invalidLimit(config.maxPerTurn)) {
    return { continue: false, reason: 'invalid-max-per-turn' };
  }
  if (invalidLimit(config.maxPerSession)) {
    return { continue: false, reason: 'invalid-max-per-session' };
  }
  if (observation.finishKind !== 'max-tokens') {
    return { continue: false, reason: 'finish-kind-not-max-tokens' };
  }
  if (config.skipWhenToolsPresent && observation.hasToolActivity) {
    return { continue: false, reason: 'tool-activity' };
  }
  if (config.skipWhenApprovalPending && observation.approvalPending) {
    return { continue: false, reason: 'approval-pending' };
  }
  if (observation.queuedInput) {
    return { continue: false, reason: 'queued-input' };
  }
  if (observation.aborted) {
    return { continue: false, reason: 'aborted' };
  }
  if (config.maxPerTurn === 1 && observation.turnCount >= 1) {
    return { continue: false, reason: 'duplicate-turn' };
  }
  if (observation.turnCount >= config.maxPerTurn) {
    return { continue: false, reason: 'per-turn-budget-exhausted' };
  }
  if (observation.sessionCount >= config.maxPerSession) {
    return { continue: false, reason: 'per-session-budget-exhausted' };
  }
  return { continue: true, reason: 'continue' };
}
