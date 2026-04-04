import { randomUUID } from 'crypto';
import { ContextGate } from './gates/context.js';
import { ToolGate } from './gates/tool.js';
import { MemoryGate } from './gates/memory.js';
import { ThreatEngine } from './threat.js';
import { InterventionEngine } from './intervention.js';
import { SecurityLogger } from './logger.js';
import { MiddlebroBlocked, SessionTerminated } from './errors.js';
import type {
  SessionState,
  SessionReport,
  ThreatLevel,
  Gate,
  SourceContext,
  GateResult,
  Observation,
  Intervention,
  EnforcementMode,
  PolicyConfig,
  LoggerConfig,
} from './types.js';
import type { WatcherRegistry } from './gates/registry.js';

export class MiddlebroSession {
  readonly id: string;

  private _state: SessionState;
  private threatEngine: ThreatEngine;
  private interventionEngine: InterventionEngine;
  private logger: SecurityLogger;
  private registry: WatcherRegistry;
  private mode: EnforcementMode;
  private interventions: Intervention[] = [];

  readonly context: ContextGate;
  readonly tool: ToolGate;
  readonly memory: MemoryGate;

  private onThreatLevelChange?: (level: ThreatLevel, state: SessionState) => void;
  private onIntervention?: (intervention: Intervention) => void;

  constructor(opts: {
    id?: string;
    registry: WatcherRegistry;
    mode: EnforcementMode;
    policy: PolicyConfig;
    logger: LoggerConfig;
    onThreatLevelChange?: (level: ThreatLevel, state: SessionState) => void;
    onIntervention?: (intervention: Intervention) => void;
  }) {
    this.id = opts.id ?? randomUUID();
    this.mode = opts.mode;
    this.registry = opts.registry;
    this.threatEngine = new ThreatEngine();
    this.interventionEngine = new InterventionEngine(opts.mode, opts.policy);
    this.logger = new SecurityLogger(opts.logger);
    if (opts.onThreatLevelChange) this.onThreatLevelChange = opts.onThreatLevelChange;
    if (opts.onIntervention) this.onIntervention = opts.onIntervention;

    this._state = {
      id: this.id,
      threatLevel: 'nominal',
      timeline: [],
      activeThreats: [],
      turnCount: 0,
      startedAt: Date.now(),
    };

    this.context = new ContextGate(this);
    this.tool = new ToolGate(this);
    this.memory = new MemoryGate(this);
  }

  get state(): SessionState {
    return this._state;
  }

  get threatLevel(): ThreatLevel {
    return this._state.threatLevel;
  }

  // Called by gates — not part of the public consumer API
  processGate(gate: Gate, content: string, source: SourceContext): GateResult {
    this._state = { ...this._state, turnCount: this._state.turnCount + 1 };

    const watchers = this.registry.resolve(gate, source, this._state.threatLevel);

    const observations: Observation[] = watchers
      .map(w => w.observe(content, { gate, source, session: this._state }))
      .filter((o): o is Observation => o !== null);

    const prevLevel = this._state.threatLevel;
    const { state, newThreats } = this.threatEngine.process(observations, this._state);
    this._state = state;

    for (const obs of observations) {
      this.logger.observation(this.id, obs);
    }

    if (this._state.threatLevel !== prevLevel) {
      this.logger.threatLevelChange(this.id, this._state.threatLevel);
      this.onThreatLevelChange?.(this._state.threatLevel, this._state);
    }

    const intervention = this.interventionEngine.decide(newThreats);
    this.interventions.push(intervention);
    this.logger.intervention(this.id, intervention);
    this.onIntervention?.(intervention);

    if (this.mode === 'enforce' && intervention.type === 'block') {
      throw new MiddlebroBlocked(intervention, newThreats);
    }

    if (this.mode === 'enforce' && intervention.type === 'terminate') {
      throw new SessionTerminated(this.id, intervention.reason ?? 'threat threshold exceeded');
    }

    const topObservation: Observation | null = observations.length > 0 ? (observations[0] ?? null) : null;
    return { intervention, observation: topObservation };
  }

  // Proactive assessment — call at any time to inspect current threat state
  assess() {
    return this._state.activeThreats.filter(t => t.status === 'active' || t.status === 'escalated');
  }

  close(): SessionReport {
    const report: SessionReport = {
      sessionId: this.id,
      duration: Date.now() - this._state.startedAt,
      threatLevel: this._state.threatLevel,
      totalObservations: this._state.timeline.length,
      threats: this._state.activeThreats,
      interventions: this.interventions.filter(i => i.type !== 'pass'),
    };

    this.logger.sessionEnd(report);
    return report;
  }
}
