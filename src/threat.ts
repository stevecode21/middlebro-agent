import { randomUUID } from 'crypto';
import type {
  Observation,
  ActiveThreat,
  ThreatLevel,
  SessionState,
  ThreatType,
  Severity,
} from './types.js';

const SEVERITY_ORDER: Severity[] = ['info', 'low', 'medium', 'high', 'critical'];

function maxSeverity(observations: Observation[]): Severity {
  let max: Severity = 'info';
  for (const obs of observations) {
    for (const signal of obs.signals) {
      const confidence = signal.confidence;
      // Only count high-confidence signals for severity escalation
      if (confidence < 0.5) continue;
      if (SEVERITY_ORDER.indexOf(signal.type as unknown as Severity) > SEVERITY_ORDER.indexOf(max)) {
        // Use confidence to determine severity bucket
        if (confidence >= 0.9) max = 'critical';
        else if (confidence >= 0.75) max = 'high';
        else if (confidence >= 0.5) max = 'medium';
      }
    }
  }
  return max;
}

function computeThreatLevel(threats: ActiveThreat[]): ThreatLevel {
  const active = threats.filter(t => t.status === 'active' || t.status === 'escalated');
  if (active.some(t => t.severity === 'critical')) return 'critical';
  if (active.some(t => t.severity === 'high')) return 'elevated';
  if (active.length > 0) return 'elevated';
  return 'nominal';
}

// Correlates observations across turns to detect multi-step attacks.
// A single observation can be noise; the same pattern across turns is a threat.
function correlate(
  incoming: Observation[],
  existing: ActiveThreat[]
): { matched: ActiveThreat[]; fresh: Observation[] } {
  const matched: ActiveThreat[] = [];
  const fresh: Observation[] = [];

  for (const obs of incoming) {
    for (const signal of obs.signals) {
      const existing_threat = existing.find(
        t => t.type === signal.type && t.status === 'active'
      );
      if (existing_threat) {
        existing_threat.observations.push(obs);
        existing_threat.status = 'escalated';
        matched.push(existing_threat);
      } else {
        fresh.push(obs);
      }
    }
  }

  return { matched, fresh };
}

export class ThreatEngine {
  process(
    incoming: Observation[],
    state: SessionState
  ): { state: SessionState; newThreats: ActiveThreat[] } {
    if (incoming.length === 0) return { state, newThreats: [] };

    const { matched, fresh } = correlate(incoming, state.activeThreats);

    // Promote fresh observations with signals into new ActiveThreats
    const newThreats: ActiveThreat[] = [];
    const seenTypes = new Set<ThreatType>();

    for (const obs of fresh) {
      for (const signal of obs.signals) {
        if (seenTypes.has(signal.type)) continue;
        seenTypes.add(signal.type);

        const severity = signal.confidence >= 0.9
          ? 'critical'
          : signal.confidence >= 0.75
            ? 'high'
            : signal.confidence >= 0.5
              ? 'medium'
              : 'low';

        newThreats.push({
          id: randomUUID(),
          type: signal.type,
          severity,
          firstSeenAt: obs.timestamp,
          observations: [obs],
          status: 'active',
        });
      }
    }

    const allThreats = [...state.activeThreats, ...newThreats];
    const newLevel = computeThreatLevel(allThreats);

    const updatedState: SessionState = {
      ...state,
      timeline: [...state.timeline, ...incoming],
      activeThreats: allThreats,
      threatLevel: newLevel,
    };

    return { state: updatedState, newThreats };
  }
}
