// Chunked, yielding work runner extracted from the useAnalysis effect. The
// effect interleaved scheduling concerns with the aggregation math; this isolates
// the scheduling so the math (analysisAggregation) and the orchestration are
// each reasoned about — and tested — on their own.

export type ScheduleWork = (callback: () => void) => void;

// Prefer requestIdleCallback (lower priority, yields to input) when present,
// otherwise fall back to the next animation frame.
export const scheduleIdleWork: ScheduleWork = (callback) => {
  if (typeof window !== 'undefined' && window.requestIdleCallback) {
    window.requestIdleCallback(callback, { timeout: 100 });
  } else {
    requestAnimationFrame(callback);
  }
};

interface RunChunkedOptions<T> {
  data: T[];
  chunkSize: number;
  schedule: ScheduleWork;
  processItem: (item: T, index: number) => void;
  // Scheduled (not called inline) once every item has been processed.
  onDone: () => void;
  // Aborts the run before each chunk — e.g. when a newer run supersedes this one.
  isCancelled: () => boolean;
  // Handles a throw from processItem; the loop stops.
  onError: (err: unknown) => void;
}

// Walk `data` in chunks of `chunkSize`, yielding to `schedule` between chunks so
// the main thread stays responsive on large datasets. After the final chunk,
// `onDone` is scheduled (matching the original effect's behavior, including the
// empty-input case where onDone still fires).
export function runChunked<T>({
  data,
  chunkSize,
  schedule,
  processItem,
  onDone,
  isCancelled,
  onError,
}: RunChunkedOptions<T>): void {
  let i = 0;

  const step = () => {
    if (isCancelled()) return;

    try {
      const end = Math.min(i + chunkSize, data.length);

      for (; i < end; i++) {
        processItem(data[i], i);
      }

      if (i < data.length) {
        schedule(step);
      } else {
        schedule(onDone);
      }
    } catch (err) {
      onError(err);
    }
  };

  schedule(step);
}
