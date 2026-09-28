'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface MarqueeLabelProps {
  text?: string;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  containerClassName?: string;
  containerStyle?: React.CSSProperties;
  speedSeconds?: number;
  speed?: number;
  gapWidth?: number;
  forceMarquee?: boolean;
  title?: string;
  as?: 'span' | 'div' | 'p';
}

export interface MarqueeStateCalculation {
  isMarquee: boolean;
  marqueeDistance: number;
  marqueeDurationSeconds: number;
  className: string;
  dataMarquee: 'true' | 'false';
  containerStyle: React.CSSProperties;
  contentStyle: React.CSSProperties;
}

/**
 * Pure calculation helper to determine marquee state and CSS variables (MS-17).
 */
export function computeMarqueeState({
  text = '',
  contentWidth = 0,
  containerWidth = 0,
  forceMarquee = false,
  speedSeconds = 3,
  speed = 35,
  gapWidth = 24,
}: {
  text?: string;
  contentWidth?: number;
  containerWidth?: number;
  forceMarquee?: boolean;
  speedSeconds?: number;
  speed?: number;
  gapWidth?: number;
}): MarqueeStateCalculation {
  const isOverflowing =
    forceMarquee ||
    (contentWidth > 0 && containerWidth > 0 && contentWidth > containerWidth);
  const duration =
    speedSeconds !== undefined
      ? speedSeconds
      : Math.max(2.5, (contentWidth + gapWidth) / speed);

  return {
    isMarquee: isOverflowing,
    marqueeDistance: isOverflowing ? gapWidth : 0,
    marqueeDurationSeconds: duration,
    className: isOverflowing ? 'da-marquee-text' : '',
    dataMarquee: isOverflowing ? 'true' : 'false',
    containerStyle: {
      position: 'relative',
      display: 'block',
      width: '100%',
      minWidth: 0,
      maxWidth: '100%',
      overflow: 'hidden',
    },
    contentStyle: isOverflowing
      ? ({
        display: 'inline-flex',
        width: 'max-content',
        whiteSpace: 'nowrap',
        animationDuration: `${duration}s`,
        '--da-marquee-duration': `${duration}s`,
      } as React.CSSProperties)
      : {
        display: 'block',
        width: '100%',
        minWidth: 0,
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        textAlign: 'center',
      },
  };
}

/**
 * Returns keyframes and styling rules for continuous right-to-left da-text-marquee animation (MS-17).
 */
export function getMarqueeKeyframesCss(): string {
  return `@keyframes da-text-marquee {
  from {
    transform: translateX(0%);
  }
  to {
    transform: translateX(-50%);
  }
}
.da-marquee-text {
  display: inline-flex;
  width: max-content;
  white-space: nowrap;
  animation: da-text-marquee var(--da-marquee-duration, 3s) linear infinite;
  will-change: transform;
}`;
}

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * MarqueeLabel Component (MS-17 / DSD-UI1 / DSD-UI2)
 *
 * Automatically detects whether text overflows its container box using an off-screen measurer.
 * If text overflows (measuredWidth > containerWidth), a continuous seamless
 * right-to-left marquee animation glides the text end-to-end without bouncing back.
 */
export function MarqueeLabel({
  text,
  children,
  className = '',
  style,
  containerClassName = '',
  containerStyle,
  speedSeconds = 6,
  speed = 35,
  gapWidth = 24,
  forceMarquee = false,
  title,
  as: Component = 'span',
}: MarqueeLabelProps) {
  const containerRef = useRef<HTMLElement>(null);
  const measurerRef = useRef<HTMLSpanElement>(null);
  const staticSpanRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(forceMarquee);
  const [textWidth, setTextWidth] = useState(0);

  const displayString =
    text !== undefined
      ? text
      : typeof children === 'string'
        ? children
        : (children !== null && children !== undefined ? String(children) : '');

  const checkOverflow = () => {
    if (forceMarquee) {
      setIsOverflowing(true);
      return;
    }
    const container = containerRef.current;
    const measurer = measurerRef.current;
    const staticSpan = staticSpanRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const containerWidth = container.clientWidth || Math.floor(containerRect.width);

    let measuredWidth = 0;
    if (measurer) {
      const measurerRect = measurer.getBoundingClientRect();
      measuredWidth = Math.ceil(
        measurerRect.width || measurer.offsetWidth || measurer.scrollWidth
      );
    }

    // Direct browser ellipsis detection: if the static label is truncated with ellipsis
    const isTruncated = staticSpan
      ? staticSpan.scrollWidth > staticSpan.clientWidth + 0.5
      : false;

    // Off-screen full measurer width overflow detection
    const isMeasuredOverflow =
      measuredWidth > 0 && containerWidth > 0 && measuredWidth > containerWidth - 0.5;

    if (isTruncated || isMeasuredOverflow) {
      setIsOverflowing(true);
      setTextWidth(measuredWidth || (containerWidth > 0 ? containerWidth + 20 : 0));
    } else {
      setIsOverflowing(false);
      setTextWidth(0);
    }
  };

  useIsomorphicLayoutEffect(() => {
    checkOverflow();
  }, [displayString, forceMarquee]);

  useEffect(() => {
    checkOverflow();

    const container = containerRef.current;
    let observer: ResizeObserver | null = null;

    if (container && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        checkOverflow();
      });
      observer.observe(container);
      if (container.parentElement) {
        observer.observe(container.parentElement);
      }
    }

    const handleResize = () => {
      checkOverflow();
    };
    window.addEventListener('resize', handleResize);

    if (typeof document !== 'undefined' && 'fonts' in document) {
      document.fonts.ready.then(checkOverflow).catch(() => { });
    }

    // Secondary pass to ensure correct measurement after DOM layout settlement
    const frameId = requestAnimationFrame(() => {
      checkOverflow();
    });

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', handleResize);
      observer?.disconnect();
    };
  }, [displayString, forceMarquee]);

  const activeMarquee = forceMarquee || isOverflowing;
  const renderedContent = text !== undefined ? text : children;
  const duration =
    speedSeconds !== undefined
      ? speedSeconds
      : Math.max(2.5, (textWidth + gapWidth) / speed);

  return (
    <>
      <style>{getMarqueeKeyframesCss()}</style>
      <Component
        ref={containerRef as React.Ref<never>}
        title={title || (typeof displayString === 'string' ? displayString : undefined)}
        className={`relative block w-full min-w-0 max-w-full overflow-hidden ${containerClassName}`}
        data-testid="marquee-label-container"
        data-marquee={activeMarquee ? 'true' : 'false'}
        style={{
          position: 'relative',
          display: 'block',
          width: '100%',
          minWidth: 0,
          maxWidth: '100%',
          overflow: 'hidden',
          ...containerStyle,
        }}
      >
        {/* Off-screen measurer to compute exact unconstrained text width */}
        <span
          ref={measurerRef}
          aria-hidden="true"
          className={`invisible absolute left-[-9999px] top-0 pointer-events-none whitespace-nowrap inline-block ${className}`}
          style={{
            ...style,
            position: 'absolute',
            left: -9999,
            top: 0,
            visibility: 'hidden',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            display: 'inline-block',
            width: 'auto',
            maxWidth: 'none',
            minWidth: 0,
            overflow: 'visible',
            textOverflow: 'clip',
            boxSizing: 'content-box',
          }}
        >
          {displayString}
        </span>

        {activeMarquee ? (
          <span
            data-testid="marquee-label-content"
            data-marquee="true"
            className="inline-flex w-max da-marquee-text will-change-transform"
            style={{
              display: 'inline-flex',
              width: 'max-content',
              whiteSpace: 'nowrap',
              animation: `da-text-marquee ${duration}s linear infinite`,
              animationDuration: `${duration}s`,
              willChange: 'transform',
            }}
          >
            <span
              className="shrink-0 inline-block"
              style={{
                paddingRight: `${gapWidth}px`,
                whiteSpace: 'nowrap',
                fontSize: style?.fontSize,
                fontWeight: style?.fontWeight,
                fontFamily: style?.fontFamily,
                color: style?.color,
                lineHeight: style?.lineHeight,
              }}
            >
              <span className={className} style={{ ...style, maxWidth: 'none', width: 'auto', display: 'inline' }}>
                {renderedContent}
              </span>
            </span>
            <span
              aria-hidden="true"
              className="shrink-0 inline-block"
              style={{
                paddingRight: `${gapWidth}px`,
                whiteSpace: 'nowrap',
                fontSize: style?.fontSize,
                fontWeight: style?.fontWeight,
                fontFamily: style?.fontFamily,
                color: style?.color,
                lineHeight: style?.lineHeight,
              }}
            >
              <span className={className} style={{ ...style, maxWidth: 'none', width: 'auto', display: 'inline' }}>
                {renderedContent}
              </span>
            </span>
          </span>
        ) : (
          <span
            ref={staticSpanRef}
            data-testid="marquee-label-content"
            data-marquee="false"
            className={`block w-full min-w-0 max-w-full text-center truncate ${className}`}
            style={{
              display: 'block',
              width: '100%',
              minWidth: 0,
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              textAlign: 'center',
              ...style,
            }}
          >
            {renderedContent}
          </span>
        )}
      </Component>
    </>
  );
}
