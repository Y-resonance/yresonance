import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';

function subscribeToReducedMotion(notify: () => void) {
  const media = window.matchMedia(reducedMotionQuery);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
}

/** True when the visitor asked for reduced motion. The server always renders the animated variant. */
export function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia(reducedMotionQuery).matches,
    () => false,
  );
}

/**
 * Reports whether the referenced element is on screen. With `once`, the value latches to true so
 * one-shot reveals do not replay when the visitor scrolls back.
 */
export function useInView<T extends Element>({ threshold = 0.3, once = false } = {}) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        setInView(entry.isIntersecting);
        if (once && entry.isIntersecting) observer.disconnect();
      },
      { threshold },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold, once]);
  return [ref, inView] as const;
}

/**
 * Walks through a list of step durations and starts over after the last one. Pausing keeps the
 * current step, so a demo that scrolls out of view resumes where it stopped.
 */
export function useLoopingSteps(durations: readonly number[], running: boolean) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(
      () => setStep((current) => (current + 1) % durations.length),
      durations[step],
    );
    return () => clearTimeout(timer);
  }, [durations, running, step]);
  return step;
}
