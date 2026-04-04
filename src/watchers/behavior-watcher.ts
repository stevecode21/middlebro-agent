import { randomUUID } from 'crypto';
import type { WatcherStrategy, Gate, ObservationContext, Observation, Signal, ThreatType } from '../types.js';

// BehaviorWatcher is session-aware — it looks at accumulated history,
// not just the current message. It detects slow-burn / multi-step attacks
// where no single turn is obviously malicious but the pattern across turns is.

const ESCALATION_THRESHOLD = 3; // observations of the same type before flagging

export class BehaviorWatcher implements WatcherStrategy {
  readonly name = 'behavior-watcher';
  readonly supportedGates: Gate[] = ['context', 'tool', 'memory'];

  observe(content: string, ctx: ObservationContext): Observation | null {
    const { session } = ctx;

    // Count how many prior observations share a threat type
    const typeCounts = new Map<ThreatType, number>();
    for (const obs of session.timeline) {
      for (const signal of obs.signals) {
        typeCounts.set(signal.type, (typeCounts.get(signal.type) ?? 0) + 1);
      }
    }

    const signals: Signal[] = [];

    for (const [type, count] of typeCounts.entries()) {
      if (count >= ESCALATION_THRESHOLD) {
        // Repeated observations of the same threat type = coordinated attack pattern
        signals.push({
          type,
          confidence: Math.min(0.6 + count * 0.05, 0.95), // confidence rises with repetition
          evidence: `${count} observations of type "${type}" across ${session.turnCount} turns`,
        });
      }
    }

    if (signals.length === 0) return null;

    return {
      id: randomUUID(),
      gate: ctx.gate,
      watcher: this.name,
      source: ctx.source,
      signals,
      timestamp: Date.now(),
      turn: session.turnCount,
    };
  }
}
