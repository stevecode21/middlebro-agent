// ─── Primitives ───────────────────────────────────────────────────────────────

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type ThreatType =
  | 'prompt_injection'
  | 'indirect_injection'
  | 'context_poisoning'
  | 'memory_poison'
  | 'jailbreak'
  | 'obfuscation';

export type Decision = 'allow' | 'warn' | 'block' | 'review';

export type EnforcementMode = 'enforce' | 'monitor' | 'warn';

export type SourceContext =
  | 'user_message'
  | 'tool_output'
  | 'retrieval'
  | 'web'
  | 'email'
  | 'system_prompt'
  | 'inter_agent';

export type Gate = 'context' | 'tool' | 'memory' | 'output';

export type ThreatLevel = 'nominal' | 'elevated' | 'critical';

export type InterventionType =
  | 'pass'
  | 'sanitize'
  | 'quarantine'
  | 'redirect'
  | 'alert'
  | 'block'
  | 'terminate';

// ─── Signals & Observations ───────────────────────────────────────────────────

export interface Signal {
  type: ThreatType;
  confidence: number; // 0–1
  evidence: string;   // matched fragment (truncated/redacted)
}

export interface Observation {
  id: string;
  gate: Gate;
  watcher: string;
  source: SourceContext;
  signals: Signal[];
  timestamp: number;
  turn: number;
}

export interface ObservationContext {
  gate: Gate;
  source: SourceContext;
  session: SessionState;
}

// ─── Threats ──────────────────────────────────────────────────────────────────

export interface ActiveThreat {
  id: string;
  type: ThreatType;
  severity: Severity;
  firstSeenAt: number;
  observations: Observation[];
  status: 'active' | 'resolved' | 'escalated';
}

export interface SessionState {
  id: string;
  threatLevel: ThreatLevel;
  timeline: Observation[];
  activeThreats: ActiveThreat[];
  turnCount: number;
  startedAt: number;
}

// ─── Interventions ────────────────────────────────────────────────────────────

export interface Intervention {
  type: InterventionType;
  threat?: ActiveThreat;
  payload?: string; // sanitized/redirected content
  reason?: string;
}

export interface GateResult {
  intervention: Intervention;
  observation: Observation | null;
}

// ─── Watcher Strategy (Strategy Pattern) ─────────────────────────────────────

export interface WatcherStrategy {
  readonly name: string;
  readonly supportedGates: Gate[];
  readonly supportedSources?: SourceContext[];
  readonly minThreatLevel?: ThreatLevel;
  observe(content: string, ctx: ObservationContext): Observation | null;
}

export interface WatcherSelectionStrategy {
  select(
    gate: Gate,
    source: SourceContext,
    threatLevel: ThreatLevel,
    available: WatcherStrategy[]
  ): WatcherStrategy[];
}

// ─── Tool Call ────────────────────────────────────────────────────────────────

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolDecision {
  decision: Decision;
  reason?: string;
  threats: ActiveThreat[];
}

// ─── Session Report ───────────────────────────────────────────────────────────

export interface SessionReport {
  sessionId: string;
  duration: number;
  threatLevel: ThreatLevel;
  totalObservations: number;
  threats: ActiveThreat[];
  interventions: Intervention[];
}

// ─── OpenAI Wire Format (subset we care about) ───────────────────────────────

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  tools?: unknown[];
  [key: string]: unknown;
}

// ─── Event Bus ────────────────────────────────────────────────────────────────

export type BusEventType =
  | 'llm:request'       // agent → LLM (intercepted before forwarding)
  | 'llm:response'      // LLM → agent (intercepted before returning)
  | 'tool:call'         // agent about to execute a tool
  | 'tool:result'       // tool result about to enter context
  | 'threat:detected'
  | 'intervention:executed'
  | 'session:start'
  | 'session:end';

export interface BusEvent<T = unknown> {
  id: string;
  type: BusEventType;
  sessionId: string;
  timestamp: number;
  payload: T;
}

// ─── Reasoner ─────────────────────────────────────────────────────────────────

export interface ReasonerVerdict {
  threat: boolean;
  confidence: number;           // 0–1
  action: InterventionType;
  reasoning: string;            // human-readable explanation
  threatType?: ThreatType;
}

export interface ReasonerInput {
  eventType: BusEventType;
  content: string;
  signals: Signal[];
  sessionSummary: string;       // last N observations as text
}

// ─── Proxy ────────────────────────────────────────────────────────────────────

export interface ProxyConfig {
  port?: number;
  targetUrl?: string;           // default: https://api.openai.com
}

export interface InterceptResult {
  blocked: boolean;
  sanitized: boolean;
  body: string;                 // original or sanitized JSON
  intervention?: Intervention;
  verdict?: ReasonerVerdict;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface PolicyConfig {
  blockOn?: Severity[];
  warnOn?: Severity[];
  overrides?: Partial<Record<ThreatType, Decision>>;
}

export interface LoggerConfig {
  quiet?: boolean;
  logFile?: string;
  webhook?: string;
  minSeverity?: Severity;
}

export interface MiddlebroConfig {
  mode?: EnforcementMode;
  watchers?: WatcherStrategy[];
  selector?: WatcherSelectionStrategy;
  policy?: PolicyConfig;
  logger?: LoggerConfig;
  onThreatLevelChange?: (level: ThreatLevel, state: SessionState) => void;
  onIntervention?: (intervention: Intervention) => void;
}
