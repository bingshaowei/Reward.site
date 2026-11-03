'use client';
import { useEffect, useState } from 'react';
import { date } from '@/lib/client';

export function TeamClock() {
  const [now, setNow] = useState('');
  useEffect(() => {
    const tick = () => setNow(new Date().toISOString());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  return <div className="top-date"><time dateTime={now || undefined}>{now && date(now, true)}</time><span className="mini-dot" />CCP团队</div>;
}
