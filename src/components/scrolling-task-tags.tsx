'use client';
import { useEffect, useRef, useState } from 'react';

export function ScrollingTaskTags({ children }: { children: React.ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null), track = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const element = viewport.current, content = track.current;
    if (!element || !content) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, previous = 0, waitUntil = 0, direction = 1, visible = false, position = 0;
    let hovered = false, focused = false, pointerDown = false, maxScroll = 0;
    function stop() { cancelAnimationFrame(frame); frame = 0; previous = 0; }
    function canScroll() { return visible && maxScroll > 1 && !reducedMotion.matches && !document.hidden && !hovered && !focused && !pointerDown; }
    function step(now: number) {
      frame = 0;
      if (!canScroll()) { previous = 0; return; }
      if (previous && now >= waitUntil) {
        const next = position + direction * 24 * Math.min(now - previous, 50) / 1000;
        position = Math.max(0, Math.min(maxScroll, next));
        element!.scrollLeft = position;
        if (next >= maxScroll || next <= 0) { direction *= -1; waitUntil = now + 1200; }
      }
      previous = now; frame = requestAnimationFrame(step);
    }
    function resume() {
      stop();
      position = element!.scrollLeft;
      if (canScroll()) { waitUntil = performance.now() + 1200; frame = requestAnimationFrame(step); }
    }
    function measure() {
      maxScroll = Math.max(0, element!.scrollWidth - element!.clientWidth);
      setOverflowing(maxScroll > 1);
      if (!maxScroll) { element!.scrollLeft = 0; direction = 1; }
      resume();
    }
    const resize = new ResizeObserver(measure);
    resize.observe(element); resize.observe(content);
    const intersection = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; resume(); });
    intersection.observe(element);
    const enter = () => { hovered = true; stop(); }, leave = () => { hovered = false; resume(); };
    const focus = () => { focused = true; stop(); }, blur = () => { focused = false; resume(); };
    const down = () => { pointerDown = true; stop(); }, up = () => { pointerDown = false; resume(); };
    element.addEventListener('mouseenter', enter); element.addEventListener('mouseleave', leave);
    element.addEventListener('focusin', focus); element.addEventListener('focusout', blur);
    element.addEventListener('pointerdown', down); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    document.addEventListener('visibilitychange', resume); reducedMotion.addEventListener('change', resume);
    measure();
    return () => {
      stop(); resize.disconnect(); intersection.disconnect();
      element.removeEventListener('mouseenter', enter); element.removeEventListener('mouseleave', leave);
      element.removeEventListener('focusin', focus); element.removeEventListener('focusout', blur);
      element.removeEventListener('pointerdown', down); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      document.removeEventListener('visibilitychange', resume); reducedMotion.removeEventListener('change', resume);
    };
  }, []);
  return <div className="task-label-scroll" ref={viewport} tabIndex={overflowing ? 0 : undefined} role="group" aria-label={overflowing ? '任务标签，可横向滚动；悬停或聚焦时暂停自动滚动' : '任务标签'}><div className="task-label-track" ref={track}>{children}</div></div>;
}
