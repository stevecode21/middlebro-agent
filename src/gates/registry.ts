import type {
  WatcherStrategy,
  WatcherSelectionStrategy,
  Gate,
  SourceContext,
  ThreatLevel,
} from '../types.js';

// Default: run all watchers that support this gate + source
export class DefaultSelector implements WatcherSelectionStrategy {
  select(gate: Gate, source: SourceContext, _: ThreatLevel, available: WatcherStrategy[]): WatcherStrategy[] {
    return available.filter(
      w =>
        w.supportedGates.includes(gate) &&
        (!w.supportedSources || w.supportedSources.includes(source))
    );
  }
}

// Activates more watchers as session threat level rises
export class AdaptiveSelector implements WatcherSelectionStrategy {
  private readonly levelOrder: ThreatLevel[] = ['nominal', 'elevated', 'critical'];

  select(gate: Gate, source: SourceContext, threatLevel: ThreatLevel, available: WatcherStrategy[]): WatcherStrategy[] {
    const currentIndex = this.levelOrder.indexOf(threatLevel);
    return available.filter(w => {
      const min = w.minThreatLevel ?? 'nominal';
      return (
        w.supportedGates.includes(gate) &&
        this.levelOrder.indexOf(min) <= currentIndex &&
        (!w.supportedSources || w.supportedSources.includes(source))
      );
    });
  }
}

export class WatcherRegistry {
  private watchers: WatcherStrategy[] = [];
  private selector: WatcherSelectionStrategy;

  constructor(selector: WatcherSelectionStrategy = new DefaultSelector()) {
    this.selector = selector;
  }

  register(watcher: WatcherStrategy): this {
    this.watchers.push(watcher);
    return this;
  }

  resolve(gate: Gate, source: SourceContext, threatLevel: ThreatLevel): WatcherStrategy[] {
    return this.selector.select(gate, source, threatLevel, this.watchers);
  }

  setSelector(selector: WatcherSelectionStrategy): void {
    this.selector = selector;
  }
}
