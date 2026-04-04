import { appendFileSync } from 'fs';
import type { Observation, Intervention, SessionReport, Severity, LoggerConfig } from './types.js';

const SEVERITY_ORDER: Severity[] = ['info', 'low', 'medium', 'high', 'critical'];

interface LogEvent {
  type: 'observation' | 'intervention' | 'session_end' | 'threat_level_change';
  sessionId: string;
  timestamp: string;
  data: unknown;
}

export class SecurityLogger {
  private config: LoggerConfig;

  constructor(config: LoggerConfig = {}) {
    this.config = config;
  }

  observation(sessionId: string, obs: Observation): void {
    const minSev = this.config.minSeverity ?? 'low';
    const topConfidence = Math.max(...obs.signals.map(s => s.confidence), 0);
    if (topConfidence < 0.5) return; // skip low-confidence noise

    this.emit({ type: 'observation', sessionId, timestamp: new Date().toISOString(), data: obs });
  }

  intervention(sessionId: string, intervention: Intervention): void {
    if (intervention.type === 'pass') return;
    this.emit({ type: 'intervention', sessionId, timestamp: new Date().toISOString(), data: intervention });
  }

  sessionEnd(report: SessionReport): void {
    this.emit({ type: 'session_end', sessionId: report.sessionId, timestamp: new Date().toISOString(), data: report });
  }

  threatLevelChange(sessionId: string, level: string): void {
    this.emit({ type: 'threat_level_change', sessionId, timestamp: new Date().toISOString(), data: { level } });
  }

  private emit(event: LogEvent): void {
    const line = JSON.stringify(event);

    if (!this.config.quiet) {
      const prefix = event.type === 'intervention' ? '🛡 ' : '👁 ';
      console.warn(`[middlebro] ${prefix}${event.type} — ${event.sessionId}`);
    }

    if (this.config.logFile) {
      appendFileSync(this.config.logFile, line + '\n');
    }

    if (this.config.webhook) {
      // Fire-and-forget; do not await in hot path
      fetch(this.config.webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: line,
      }).catch(() => {}); // intentional no-op on failure
    }
  }
}
