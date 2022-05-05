/**
 * Adapted from mobx's react observer implementation.
 */
import {FunctionComponent} from 'preact';
import {once, fnName, Disposer} from 'statin';
import {useRef, useEffect, useState, MutableRef} from 'preact/hooks';

interface ReactionTracking {
	dispose: Disposer;

	// The time (in ticks) at which point we should dispose of the reaction
	// if this component hasn't yet been fully mounted.
	cleanAt: number;

	// Whether the component has yet completed mounting (useEffect has run)
	mounted?: boolean;
}

/**
 * The minimum time before we'll clean up a Reaction created in a render
 * for a component that hasn't managed to run its effects. This needs to
 * be big enough to ensure that a component won't turn up and have its
 * effects run without being re-rendered.
 */
const CLEANUP_TIME = 10_000;

/**
 * Reactions created by components that have yet to be fully mounted.
 */
const uncommittedReactionRefs: Set<MutableRef<ReactionTracking | null>> = new Set();

function createTrackingData(dispose: Disposer) {
	const trackingData: ReactionTracking = {
		cleanAt: Date.now() + CLEANUP_TIME,
		dispose,
	};
	return trackingData;
}

/**
 * Latest 'uncommitted reactions' cleanup timer handle.
 */
let reactionCleanupHandle: ReturnType<typeof setTimeout> | undefined;

function ensureCleanupTimerRunning() {
	if (reactionCleanupHandle === undefined) {
		reactionCleanupHandle = setTimeout(cleanUncommittedReactions, CLEANUP_TIME);
	}
}

function scheduleCleanupOfReactionIfLeaked(ref: MutableRef<ReactionTracking | null>) {
	uncommittedReactionRefs.add(ref);
	ensureCleanupTimerRunning();
}

function recordReactionAsCommitted(reactionRef: MutableRef<ReactionTracking | null>) {
	uncommittedReactionRefs.delete(reactionRef);
}

/**
 * Run by the cleanup timer to dispose any outstanding reactions
 */
function cleanUncommittedReactions() {
	reactionCleanupHandle = undefined;

	// Loop through all the candidate leaked reactions; those older
	// than CLEANUP_LEAKED_REACTIONS_AFTER_MS get tidied.

	const now = Date.now();
	uncommittedReactionRefs.forEach((ref) => {
		const tracking = ref.current;

		if (tracking && now >= tracking.cleanAt) {
			// It's time to tidy up this leaked reaction.
			tracking.dispose();
			ref.current = null;
			uncommittedReactionRefs.delete(ref);
		}
	});

	if (uncommittedReactionRefs.size > 0) {
		// We've just finished a round of cleanups but there are still
		// some leak candidates outstanding.
		ensureCleanupTimerRunning();
	}
}

let _isSSR = false;

/**
 * Check if server side rendering is enabled or not.
 */
export const isSSR = () => _isSSR;

/**
 * Enable or disable server side rendering mode where observer() just lets
 * components pass through and doesn't register any observers.
 *
 * This is required because observer depends on `useEffect`, which doesn't ever
 * fire during SSR, leading to stalled rendering.
 */
export const setSSR = (value: boolean) => (_isSSR = value);

/**
 * Accepts component that should be re-rendered whenever any signal used during
 * it's rendering changes.
 */
export function observer<T extends object>(
	Component: FunctionComponent<T>,
	{onError}: {onError?: (error: unknown) => void} = {}
): FunctionComponent<T> {
	// In server side rendering we just return the component as there is no
	// need to react to signal changes.
	if (_isSSR) return Component;

	const componentName = fnName(Component, 'Unknown');
	const observerName = `${componentName}Observer`;
	const wrappedComponent: FunctionComponent<T> = function (...args) {
		const [, passNaNToUpdate] = useState(NaN); // Force update

		// StrictMode/ConcurrentMode/Suspense may mean that our component is
		// rendered and abandoned multiple times, so we need to track leaked
		// Reactions.
		const reactionTrackingRef = useRef<ReactionTracking | null>(null);

		// If reaction was triggered between 1st render and `useEffect()`, we need
		// to flip this so that `useEffect()` triggers update.
		let effectShouldUpdate = false;

		useEffect(() => {
			// Called on first mount only
			recordReactionAsCommitted(reactionTrackingRef);

			if (reactionTrackingRef.current) {
				// Great. We've already got our reaction from our render;
				// all we need to do is to record that it's now mounted,
				// to allow future observable changes to trigger re-renders
				reactionTrackingRef.current.mounted = true;
			}

			if (effectShouldUpdate) passNaNToUpdate(NaN);

			return () => {
				reactionTrackingRef.current!.dispose();
				reactionTrackingRef.current = null;
			};
		}, []);

		// Render the original component, but have the
		// reaction track the observables, so that rendering
		// can be invalidated once a dependency changes
		let rendering!: ReturnType<typeof Component>;
		let hasError = false;
		let error: unknown;

		// Dispose of previous reaction
		reactionTrackingRef.current?.dispose();

		// Set up a render action
		const render = () => {
			try {
				rendering = Component(...args);
			} catch (_error) {
				hasError = true;
				error = _error;
			}
		};
		render.displayName = observerName;

		const preactStatinObserverEffect = () => {
			/**
			 * Observable has changed, meaning we want to re-render BUT if we're
			 * a component that hasn't yet got to the useEffect() stage, we
			 * might be a component that _started_ to render, but got dropped,
			 * and we don't want to make state changes then. (It triggers
			 * warnings in StrictMode, for a start.)
			 */
			if (reactionTrackingRef.current?.mounted) {
				// We have reached useEffect(), so we're mounted, and can trigger an update
				passNaNToUpdate(NaN);
			} else {
				// We haven't yet reached useEffect(), so we'll need to trigger a re-render
				// when (and if) useEffect() arrives.
				effectShouldUpdate = true;
			}
		};

		const dispose = once(render, preactStatinObserverEffect);

		// Update disposer or create tracking data
		if (reactionTrackingRef.current) {
			reactionTrackingRef.current.dispose = dispose;
		} else {
			reactionTrackingRef.current = createTrackingData(dispose);
			scheduleCleanupOfReactionIfLeaked(reactionTrackingRef);
		}

		if (hasError) {
			// Promise pass-through (handled by Suspense / Error Boundary higher up in the component tree)
			if (typeof (error as Promise<void>)?.then === 'function') throw error;
			if (onError) onError(error);
			else console.error(error);
			return null;
		}

		return rendering;
	};

	wrappedComponent.displayName = componentName;

	return wrappedComponent;
}
