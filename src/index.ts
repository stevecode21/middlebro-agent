import { WatcherRegistry, DefaultSelector } from './gates/registry.js';
import { MiddlebroSession } from './session.js';
import { ContextWatcher } from './watchers/context-watcher.js';
import { ObfuscationWatcher } from './watchers/obfuscation-watcher.js';
import { MemoryWatcher } from './watchers/memory-watcher.js';
import { JailbreakWatcher } from './watchers/jailbreak-watcher.js';
import { BehaviorWatcher } from './watchers/behavior-watcher.js';
import { ToolWatcher } from './watchers/tool-watcher.js';
import type {
  MiddlebroConfig,
  EnforcementMode,
  PolicyConfig,
  LoggerConfig,
} from './types.js';

export class Middlebro {
  private readonly mode: EnforcementMode;
  private readonly policy: PolicyConfig;
  private readonly loggerConfig: LoggerConfig;
  private readonly onThreatLevelChange?: MiddlebroConfig['onThreatLevelChange'];
  private readonly onIntervention?: MiddlebroConfig['onIntervention'];
  private registry: WatcherRegistry;

  constructor(config: MiddlebroConfig = {}) {
    this.mode = config.mode ?? 'enforce';
    this.policy = config.policy ?? {};
    this.loggerConfig = config.logger ?? {};
    this.onThreatLevelChange = config.onThreatLevelChange;
    this.onIntervention = config.onIntervention;

    const selector = config.selector ?? new DefaultSelector();
    this.registry = new WatcherRegistry(selector);

    // Register default watcher set
    const watchers = config.watchers ?? [
      new ContextWatcher(),
      new ObfuscationWatcher(),
      new MemoryWatcher(),
      new JailbreakWatcher(),
      new BehaviorWatcher(),
      new ToolWatcher(),
    ];

    for (const w of watchers) {
      this.registry.register(w);
    }
  }

  session(id?: string): MiddlebroSession {
    return new MiddlebroSession({
      ...(id !== undefined ? { id } : {}),
      registry: this.registry,
      mode: this.mode,
      policy: this.policy,
      logger: this.loggerConfig,
      ...(this.onThreatLevelChange
        ? { onThreatLevelChange: this.onThreatLevelChange }
        : {}),
      ...(this.onIntervention ? { onIntervention: this.onIntervention } : {}),
    });
  }
}

// Named exports for consumers who want individual pieces
export { MiddlebroSession } from './session.js';
export {
  MiddlebroBlocked,
  SessionTerminated,
  formatBlockedForTerminal,
} from './errors.js';
export {
  WatcherRegistry,
  DefaultSelector,
  AdaptiveSelector,
} from './gates/registry.js';
export { ContextWatcher } from './watchers/context-watcher.js';
export { ObfuscationWatcher } from './watchers/obfuscation-watcher.js';
export { MemoryWatcher } from './watchers/memory-watcher.js';
export { JailbreakWatcher } from './watchers/jailbreak-watcher.js';
export { BehaviorWatcher } from './watchers/behavior-watcher.js';
export { ToolWatcher } from './watchers/tool-watcher.js';
export type * from './types.js';
