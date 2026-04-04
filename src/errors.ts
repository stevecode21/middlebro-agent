import type { ActiveThreat, Intervention, Severity } from './types.js';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
};

export class MiddlebroBlocked extends Error {
  readonly threats: ActiveThreat[];
  readonly severity: Severity;
  readonly intervention: Intervention;

  constructor(intervention: Intervention, threats: ActiveThreat[]) {
    const top = threats[0];
    super(
      `Middlebro blocked: ${top?.type ?? 'unknown'} (${top?.severity ?? 'unknown'})`,
    );
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

export interface FormattedBlockedMessage {
  title: string;
  body: string;
}

/**
 * Reusable terminal-friendly formatter for Middlebro blocked errors.
 * Useful for CLIs and demos that want a consistent blocked alert style.
 */
export function formatBlockedForTerminal(
  error: MiddlebroBlocked,
  options: { useColor?: boolean } = {},
): FormattedBlockedMessage {
  const useColor = options.useColor ?? true;
  const threats = error.threats.map((t) => t.type).join(', ') || 'unknown';

  if (!useColor) {
    return {
      title: 'BLOCKED BY MIDDLEBRO',
      body: `${error.message}\nTHREATS: ${threats}`,
    };
  }

  return {
    title: `${ANSI.bold}${ANSI.bgRed}${ANSI.yellow} BLOCKED BY MIDDLEBRO ${ANSI.reset}`,
    body:
      `${ANSI.bold}${ANSI.red}${error.message}${ANSI.reset}` +
      `\n${ANSI.bgYellow}${ANSI.red} THREATS ${ANSI.reset} ${ANSI.bold}${ANSI.red}${threats}${ANSI.reset}`,
  };
}
