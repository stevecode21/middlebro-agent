import { WatcherRegistry, DefaultSelector } from './gates/registry.js';
import { MiddlebroSession } from './session.js';
import { ContextWatcher } from './watchers/context-watcher.js';
import { ObfuscationWatcher } from './watchers/obfuscation-watcher.js';
import { MemoryWatcher } from './watchers/memory-watcher.js';
import { JailbreakWatcher } from './watchers/jailbreak-watcher.js';
import { BehaviorWatcher } from './watchers/behavior-watcher.js';
import { ToolWatcher } from './watchers/tool-watcher.js';
import {
  MiddlebroBlocked,
  formatBlockedForTerminal,
  type FormattedBlockedMessage,
} from './errors.js';
import type {
  MiddlebroConfig,
  EnforcementMode,
  PolicyConfig,
  LoggerConfig,
  SourceContext,
  SessionReport,
} from './types.js';

export class Middlebro {
  private readonly mode: EnforcementMode;
  private readonly policy: PolicyConfig;
  private readonly loggerConfig: LoggerConfig;
  private readonly onThreatLevelChange?: MiddlebroConfig['onThreatLevelChange'];
  private readonly onIntervention?: MiddlebroConfig['onIntervention'];
  private registry: WatcherRegistry;
  private defaultSession?: MiddlebroSession;

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

  private getDefaultSession(): MiddlebroSession {
    if (!this.defaultSession) {
      this.defaultSession = this.session();
    }
    return this.defaultSession;
  }

  /**
   * Minimal integration helper.
   * Example: mb.guard(userInput, { from: 'user_message' })
   */
  guard(
    content: string,
    opts: { from?: SourceContext; session?: MiddlebroSession } = {},
  ): string {
    const activeSession = opts.session ?? this.getDefaultSession();
    const from = opts.from ?? 'user_message';
    activeSession.context.check(content, { from });
    return content;
  }

  guardMessages(
    messages: Array<{ role: string; content: string }>,
    opts: { session?: MiddlebroSession } = {},
  ): Array<{ role: string; content: string }> {
    const activeSession = opts.session ?? this.getDefaultSession();

    for (const msg of messages) {
      const from: SourceContext =
        msg.role === 'user'
          ? 'user_message'
          : msg.role === 'tool'
            ? 'tool_output'
            : msg.role === 'assistant'
              ? 'inter_agent'
              : 'system_prompt';

      activeSession.context.check(msg.content, { from });
    }

    return messages;
  }

  guardToolResult(
    result: string,
    opts: { session?: MiddlebroSession } = {},
  ): string {
    const activeSession = opts.session ?? this.getDefaultSession();
    activeSession.context.check(result, { from: 'tool_output' });
    return result;
  }

  close(opts: { session?: MiddlebroSession } = {}): SessionReport {
    const activeSession = opts.session ?? this.getDefaultSession();
    return activeSession.close();
  }

  /**
   * Returns true when an unknown error is a Middlebro block event.
   */
  isBlockedError(error: unknown): boolean {
    return error instanceof MiddlebroBlocked;
  }

  /**
   * Formats a blocked error for CLI output without importing MiddlebroBlocked.
   * Returns null when the error is not a Middlebro block event.
   */
  formatBlockedError(
    error: unknown,
    options: { useColor?: boolean } = {},
  ): FormattedBlockedMessage | null {
    if (!(error instanceof MiddlebroBlocked)) {
      return null;
    }
    return formatBlockedForTerminal(error, options);
  }
}

// Named exports for consumers who want individual pieces
export { MiddlebroSession } from './session.js';
export { SessionTerminated } from './errors.js';
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
