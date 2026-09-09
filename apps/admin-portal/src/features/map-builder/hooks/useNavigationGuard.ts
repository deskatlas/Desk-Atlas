import { useEffect, useRef } from 'react';
import { NAVIGATION_WARNING_MESSAGE } from '@deskatlas/domain';

export interface UseNavigationGuardOptions {
  isDirty: boolean;
  onConfirmLeave?: () => void;
}

/**
 * Hook to guard against accidental navigation when the map editor has unsaved changes.
 * - Intercepts browser tab close / refresh via beforeunload
 * - Intercepts in-app navigation clicks (sidebar, external links) via capture-phase click handler
 * - Intercepts history popstate (browser back/forward)
 */
export function useNavigationGuard({ isDirty, onConfirmLeave }: UseNavigationGuardOptions) {
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  const onConfirmLeaveRef = useRef(onConfirmLeave);
  onConfirmLeaveRef.current = onConfirmLeave;

  useEffect(() => {
    // 1. Browser tab close or refresh
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return;
      e.preventDefault();
      e.returnValue = NAVIGATION_WARNING_MESSAGE;
      return NAVIGATION_WARNING_MESSAGE;
    };

    // 2. Intercept navigation clicks outside the Map Builder screen
    const handleClickCapture = (e: MouseEvent) => {
      if (!isDirtyRef.current) return;

      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Check if click is inside the Map Builder screen container
      const insideEditor = target.closest('[data-screen-label="Map Builder"]');
      if (insideEditor) {
        return;
      }

      // If click is outside the editor (e.g. sidebar navigation, top header, etc.)
      const isNavClick = target.closest('aside, nav, a, button, [role="button"], [data-nav-item="true"]');
      if (isNavClick) {
        const confirmed = window.confirm(NAVIGATION_WARNING_MESSAGE);
        if (!confirmed) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        } else {
          isDirtyRef.current = false;
          onConfirmLeaveRef.current?.();
        }
      }
    };

    // 3. Intercept browser back/forward buttons
    const handlePopState = () => {
      if (!isDirtyRef.current) return;
      const confirmed = window.confirm(NAVIGATION_WARNING_MESSAGE);
      if (!confirmed) {
        window.history.pushState(null, '', window.location.href);
      } else {
        isDirtyRef.current = false;
        onConfirmLeaveRef.current?.();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('click', handleClickCapture, true);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('click', handleClickCapture, true);
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);
}
