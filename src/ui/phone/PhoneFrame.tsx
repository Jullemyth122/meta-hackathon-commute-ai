/** A phone screen in the side panel: what one driver or one commuter sees. */

import type { ReactNode } from 'react';

export function PhoneFrame({
  app,
  who,
  children,
}: {
  app: string;
  who: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="phone">
      <div className="phone__bar">
        <span className="phone__app">{app}</span>
        <span className="phone__who">{who}</span>
      </div>
      <div className="phone__screen">{children}</div>
    </div>
  );
}
