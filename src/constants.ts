// App-level tuning knobs. Grouped here so the sampling/timing thresholds are
// discoverable in one place rather than buried as literals across components.

// Max points handed to Recharts after LTTB downsampling — keeps the chart
// responsive without visibly degrading the line.
export const MAX_CHART_POINTS = 800;

// Table rows per page.
export const ROWS_PER_PAGE = 50;

// Floor (ms) on the chart "Aggregating…" overlay so fast runs don't flash it.
export const MIN_LOADING_TIME = 300;

// Artificial delay (ms) before sample data appears — mirrors the parse spinner
// of a real upload so the demo feels consistent.
export const SAMPLE_LOAD_DELAY = 300;

// Resolution of the range-brush overview series (downsampled points).
export const BRUSH_POINTS = 200;

// Above this many readings a freshly loaded block defaults to DAILY resolution
// instead of RAW, to avoid an expensive first render.
export const BLOCK_DAILY_THRESHOLD = 2000;

// Percent change in $/kWh that counts as a rate change in the Rate Changes card.
export const RATE_TOLERANCE_PERCENT = 8;

// Peak-rate bands are only honest while the rendered series still resolves each
// hour. Once LTTB downsampling stretches the gap between plotted points past
// this, a band's edges land on whichever point survived sampling rather than on
// the real period boundary — so the bands are hidden instead of drawn wrong.
export const PEAK_BAND_MAX_STEP_SECONDS = 3600;
