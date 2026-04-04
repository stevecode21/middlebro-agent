import type { ActiveThreat, Intervention, Severity } from './types.js';

export class MiddlebroBlocked extends Error {
  readonly threats: ActiveThreat[];
  readonly severity: Severity;
  readonly intervention: Intervention;

  constructor(intervention: Intervention, threats: ActiveThreat[]) {
    const top = threats[0];
    super(`Middlebro blocked: ${top?.type ?? 'unknown'} (${top?.severity ?? 'unknown'})`);
    this.name = 'MiddlebroBlocked';
    this.intervention = intervention;
    this.threats = threats;
    this.severity = top?.severity ?? 'low';
  }
}

export class SessionTerminated extends Error {
  readonly sessionId: string;

  constructor(sessionId: string, reason: string) {
    super(`Session ${sessionId} terminated: ${reason}`);
    this.name = 'SessionTerminated';
    this.sessionId = sessionId;
  }
}
