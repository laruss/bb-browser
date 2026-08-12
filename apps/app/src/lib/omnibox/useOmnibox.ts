import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  createOmniboxController,
  EMPTY_OMNIBOX_STATE,
  type OmniboxController,
  type OmniboxState,
} from "./controller";
import type { OmniboxProvider } from "./types";

export interface UseOmniboxArgs {
  debounceMs?: number;
  /**
   * Rebuilt by the caller whenever its inputs change (open tabs, history). The
   * controller is not recreated for that — it is handed the new list — so a run
   * in progress survives a page finishing its load mid-query.
   */
  providers: readonly OmniboxProvider[];
}

export interface OmniboxSession extends OmniboxState {
  /** Drop the suggestion list (on blur, Escape, or after acting on a row). */
  clear: () => void;
  setQuery: (text: string) => void;
}

/**
 * React binding for {@link createOmniboxController}. Owns only the query
 * lifecycle — selection and keyboard handling belong to the component that
 * renders the list, which is where the DOM focus lives.
 */
export function useOmnibox(args: UseOmniboxArgs): OmniboxSession {
  const [state, setState] = useState<OmniboxState>(EMPTY_OMNIBOX_STATE);
  const controllerRef = useRef<OmniboxController | null>(null);
  // The controller is created on demand from whatever the latest args are, which
  // by then is what this ref holds.
  const argsRef = useRef(args);
  useLayoutEffect(() => {
    argsRef.current = args;
  }, [args]);

  // Created on first use rather than during render or in a mount effect: a
  // remount (StrictMode's double-invoked effects, for one) disposes the
  // controller, and the next keystroke must get a live one back.
  const getController = useCallback((): OmniboxController => {
    const existing = controllerRef.current;
    if (existing !== null) {
      return existing;
    }
    const created = createOmniboxController({
      debounceMs: argsRef.current.debounceMs,
      onState: setState,
      providers: argsRef.current.providers,
    });
    controllerRef.current = created;
    return created;
  }, []);

  useEffect(() => {
    // Only an already-created controller needs telling; a later one reads the
    // current list itself.
    controllerRef.current?.setProviders(args.providers);
  }, [args.providers]);

  useEffect(
    () => () => {
      controllerRef.current?.dispose();
      controllerRef.current = null;
    },
    [],
  );

  const setQuery = useCallback(
    (text: string) => {
      getController().setQuery(text);
    },
    [getController],
  );

  const clear = useCallback(() => {
    controllerRef.current?.clear();
    setState(EMPTY_OMNIBOX_STATE);
  }, []);

  return { ...state, clear, setQuery };
}
