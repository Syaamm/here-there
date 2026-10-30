import { Injectable, OnModuleInit } from '@nestjs/common';
import { LiveService } from './live.service';

/**
 * Things that happen in the app, named once. A service says WHAT happened (`events.emit({ type: 'activity.members_changed', ... })`)
 * and does not decide who hears about it. Subscribers decide: today the live updates (open screens refresh at once); alerts,
 * pushes and the audit trail can be added as subscribers the same way, so a new feature that emits the event gets all of them
 * and cannot forget one.
 *
 * Rule for new code: do not call `LiveService.feedChanged` or `groupChanged` from a service. Emit an event instead (add a
 * type below if none fits) and handle it in the subscriber at the bottom of this file.
 */
export type DomainEvent =
  // activities (HERE)
  | { type: 'activity.created'; id: string; city: string }
  | { type: 'activity.changed'; id: string; city: string } // time, place, limit or other details
  | { type: 'activity.cancelled'; id: string; city: string }
  | { type: 'activity.members_changed'; id: string; city: string } // someone joined, was approved, left, was removed or came off the waiting list
  // trips (THERE); `cities` are where it starts and where it goes
  | { type: 'trip.created'; id: string; cities: string[] }
  | { type: 'trip.changed'; id: string; cities: string[] }
  | { type: 'trip.cancelled'; id: string; cities: string[] }
  | { type: 'trip.members_changed'; id: string; cities: string[] }
  | { type: 'trip.plan_changed'; id: string } // an itinerary or budget line was added, changed or removed
  | { type: 'trip.poll_changed'; id: string } // a date poll was answered, closed or its dates confirmed
  // everything on every feed may have changed (an account was deleted, trips were completed in bulk)
  | { type: 'feed.refresh' };

type Handler = (e: DomainEvent) => Promise<void> | void;

/** The in-process bus. A subscriber that fails is logged and never stops the others, or the request that emitted. */
@Injectable()
export class EventBus {
  private readonly handlers: Handler[] = [];

  subscribe(fn: Handler) {
    this.handlers.push(fn);
  }

  /** Tell every subscriber. Does not wait for them: the person who caused it never waits for a refresh or a push. */
  emit(event: DomainEvent) {
    for (const h of this.handlers) {
      try {
        void Promise.resolve(h(event)).catch((e) => console.error(`Subscriber failed on ${event.type}:`, e?.message ?? e));
      } catch (e) {
        console.error(`Subscriber failed on ${event.type}:`, (e as Error)?.message ?? e);
      }
    }
  }
}

/** Live updates: open feeds, chats and plan screens ask again at once instead of waiting for their next poll. */
@Injectable()
export class LiveSubscriber implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly live: LiveService,
  ) {}

  onModuleInit() {
    this.bus.subscribe((e) => {
      switch (e.type) {
        case 'activity.created':
          return this.live.feedChanged([e.city]);
        case 'activity.changed':
        case 'activity.cancelled':
        case 'activity.members_changed':
          this.live.feedChanged([e.city]);
          return this.live.groupChanged('activity', e.id);
        case 'trip.created':
          return this.live.feedChanged(e.cities);
        case 'trip.changed':
        case 'trip.cancelled':
        case 'trip.members_changed':
          this.live.feedChanged(e.cities);
          return this.live.groupChanged('trip', e.id);
        case 'trip.plan_changed':
        case 'trip.poll_changed':
          return this.live.groupChanged('trip', e.id);
        case 'feed.refresh':
          return this.live.feedChanged();
      }
    });
  }
}
