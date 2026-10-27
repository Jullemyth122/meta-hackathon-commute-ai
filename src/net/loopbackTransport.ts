/**
 * Same-browser transport over BroadcastChannel. Open /track in one tab and the
 * dashboard in another: no accounts, no network, no cost.
 */

import type { SessionUpdate } from '@/core/tracking/types';
import { isSessionUpdate, type Transport } from './transport';

const CHANNEL = 'commuteai.telemetry';

export function createLoopbackTransport(): Transport {
  const channel = new BroadcastChannel(CHANNEL);

  return {
    kind: 'loopback',
    async publish(update: SessionUpdate) {
      channel.postMessage(update);
    },
    subscribe(onUpdate) {
      const listener = (e: MessageEvent) => {
        if (isSessionUpdate(e.data)) onUpdate(e.data);
      };
      channel.addEventListener('message', listener);
      return () => channel.removeEventListener('message', listener);
    },
  };
}
