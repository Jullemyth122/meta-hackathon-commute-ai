/**
 * Firebase Realtime Database transport (free Spark plan is enough here).
 *
 * Layout:
 *   sessions/{sessionId}        latest { meta, fix, trip }   (what dashboards watch)
 *   traces/{sessionId}/{push}   every fix                    (replay / route recording)
 *
 * Both sides sign in anonymously so the database rules can require auth.
 * See database.rules.json.
 */

import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getDatabase, onChildAdded, onChildChanged, push, ref, set } from 'firebase/database';
import type { FirebaseWebConfig } from '@/config';
import type { SessionUpdate } from '@/core/tracking/types';
import { isSessionUpdate, type Transport } from './transport';

export function createFirebaseTransport(cfg: FirebaseWebConfig): Transport {
  const app: FirebaseApp = initializeApp(cfg);
  const db = getDatabase(app);
  // One sign-in shared by every call; failures surface on the first use.
  const ready = signInAnonymously(getAuth(app));

  return {
    kind: 'firebase',
    async publish(update: SessionUpdate) {
      await ready;
      const id = update.meta.sessionId;
      await Promise.all([
        set(ref(db, `sessions/${id}`), update),
        push(ref(db, `traces/${id}`), update.fix),
      ]);
    },
    subscribe(onUpdate) {
      let off: Array<() => void> = [];
      let cancelled = false;
      void ready.then(() => {
        if (cancelled) return;
        const sessions = ref(db, 'sessions');
        const handle = (snap: { val(): unknown }) => {
          const value = snap.val();
          if (isSessionUpdate(value)) onUpdate(value);
        };
        off = [onChildAdded(sessions, handle), onChildChanged(sessions, handle)];
      });
      return () => {
        cancelled = true;
        off.forEach((fn) => fn());
      };
    },
  };
}
