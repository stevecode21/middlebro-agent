import type {
  ActiveThreat,
  Intervention,
  InterventionType,
  PolicyConfig,
  EnforcementMode,
  Severity,
} from './types.js';

const SEVERITY_ORDER: Severity[] = ['info', 'low', 'medium', 'high', 'critical'];

const DEFAULT_POLICY: Required<Pick<PolicyConfig, 'blockOn' | 'warnOn'>> = {
  blockOn: ['critical', 'high'],
  warnOn: ['medium'],
};

function topSeverity(threats: ActiveThreat[]): Severity {
  let top: Severity = 'info';
  for (const t of threats) {
    if (SEVERITY_ORDER.indexOf(t.severity) > SEVERITY_ORDER.indexOf(top)) {
      top = t.severity;
    }
  }
  return top;
}

export class InterventionEngine {
  private mode: EnforcementMode;
  private policy: Required<Pick<PolicyConfig, 'blockOn' | 'warnOn'>>;

  constructor(mode: EnforcementMode = 'enforce', policy: PolicyConfig = {}) {
    this.mode = mode;
    this.policy = {
      blockOn: policy.blockOn ?? DEFAULT_POLICY.blockOn,
      warnOn: policy.warnOn ?? DEFAULT_POLICY.warnOn,
    };
  }

  decide(threats: ActiveThreat[]): Intervention {
    const active = threats.filter(t => t.status === 'active' || t.status === 'escalated');

    if (active.length === 0) {
      return { type: 'pass' };
    }

    const severity = topSeverity(active);
    const top = active.find(t => t.severity === severity)!;

    // In monitor mode — always pass, never intervene
    if (this.mode === 'monitor') {
      return { type: 'alert', threat: top, reason: `[monitor] ${top.type} (${severity})` };
    }

    const shouldBlock = this.policy.blockOn.includes(severity);
    const shouldWarn = this.policy.warnOn.includes(severity);

    if (shouldBlock) {
      const type: InterventionType = this.mode === 'enforce' ? 'block' : 'alert';
      return { type, threat: top, reason: `${top.type} detected (${severity})` };
    }

    if (shouldWarn || this.mode === 'warn') {
      return { type: 'alert', threat: top, reason: `${top.type} detected (${severity})` };
    }

    return { type: 'pass' };
  }
}
