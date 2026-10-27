import { createContext, useContext } from 'react';
import type { DoorwayRuntime } from './doorwayRuntime';
import type { TwinRuntime } from './twinRuntime';

export interface Runtimes {
  twin: TwinRuntime;
  doorway: DoorwayRuntime;
}

export const RuntimeContext = createContext<Runtimes | null>(null);

export function useRuntimes(): Runtimes {
  const r = useContext(RuntimeContext);
  if (!r) throw new Error('useRuntimes must be used inside <RuntimeContext.Provider>');
  return r;
}
