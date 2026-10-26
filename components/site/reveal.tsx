"use client";

import { createElement, useEffect, useRef, type CSSProperties, type ReactNode } from "react";

type RevealProps = {
  as?: "div" | "li" | "article" | "ul" | "section";
  /** Rise in from just below, or settle in from slightly smaller. */
  from?: "below" | "scale";
  /** Stagger delay in ms. */
  delay?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
};

/**
 * Scroll-in reveal with a tiny IntersectionObserver. Content is visible by default: it only gets
 * hidden (data-reveal="pending") after hydration, and only if it's still below the fold, so the
 * server-rendered page never ships blank. Reduced-motion users skip it entirely (see globals.css).
 */
export function Reveal({ as = "div", from = "below", delay = 0, className, style, children }: RevealProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;

    el.dataset.reveal = "pending";
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.dataset.reveal = "shown";
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return createElement(
    as,
    {
      ref,
      className,
      "data-reveal": "",
      "data-reveal-from": from,
      style: { ...style, "--reveal-delay": `${delay}ms` } as CSSProperties,
    },
    children,
  );
}
