import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type { BusEvent, BusEventType } from '../types.js';

type BusListener<T> = (event: BusEvent<T>) => void;

// Typed event bus. All interception planes publish here.
// The session subscribes to correlate events over time.
class MiddlebroBus extends EventEmitter {
  override emit<T>(eventType: BusEventType, sessionId: string, payload: T): boolean {
    const event: BusEvent<T> = {
      id: randomUUID(),
      type: eventType,
      sessionId,
      timestamp: Date.now(),
      payload,
    };
    return super.emit(eventType, event);
  }

  override on<T>(eventType: BusEventType, listener: BusListener<T>): this {
    return super.on(eventType, listener as (event: BusEvent) => void);
  }

  override off<T>(eventType: BusEventType, listener: BusListener<T>): this {
    return super.off(eventType, listener as (event: BusEvent) => void);
  }
}

// Singleton bus — all parts of the system share one bus per process
export const bus = new MiddlebroBus();
bus.setMaxListeners(50);

export type { BusListener };
