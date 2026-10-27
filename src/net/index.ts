import { config } from '@/config';
import { createLoopbackTransport } from './loopbackTransport';
import type { Transport } from './transport';

let transport: Promise<Transport> | null = null;

/**
 * The app-wide transport. Firebase when configured, loopback otherwise.
 * Firebase is loaded lazily so the loopback path never downloads its SDK.
 */
export function getTransport(): Promise<Transport> {
  transport ??= config.firebase
    ? import('./firebaseTransport').then((m) => m.createFirebaseTransport(config.firebase!))
    : Promise.resolve(createLoopbackTransport());
  return transport;
}

export type { Transport } from './transport';
