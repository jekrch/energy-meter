import React, { useMemo, useRef, useState } from 'react';
import {
    CalendarClock, Check, ChevronDown, ChevronUp, Copy, CopyPlus, Download,
    ListOrdered, Plus, Trash2, Upload, X,
} from 'lucide-react';
import { Modal, type ModalHandle } from './Modal';
import {
    DAYS_OF_WEEK, MONTHS, PEAK_COLORS, PEAK_COLOR_KEYS, OFF_PEAK,
    type HourRange, type PeakColorKey, type PeakPeriod, type PeakRule, type PeakSchedule,
} from '../../types';
import { buildPeakIndex, classify, parsePeakScheduleJson } from '../../utils/peakSchedule';
import {
    PEAK_TEMPLATES, SUMMER_MONTHS, WINTER_MONTHS, describeDays, describeHours,
    describeMonths, formatExclusiveEnd, formatHour12, newPeriod,
} from '../../utils/peakScheduleFormat';
import { HOLIDAY_RULES, DEFAULT_HOLIDAY_RULES, type HolidayRuleKey } from '../../utils/holidays';

// Editor for the time-of-use peak schedule. Every control writes straight
// through to the parent's schedule — there is no draft/apply step, so the bands
// behind the modal update as the rules are edited.
//
// Layout: periods on the left, the week preview and schedule-wide options in a
// rail on the right, so the grid that proves a rule right stays on screen while
// the rule is being edited.

const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKENDS = [0, 6];
const HOURS_IN_WEEK = 7 * 24;

const emptySchedule = (): PeakSchedule => ({
    version: 1,
    periods: [],
    observeHolidays: true,
    holidayRules: [...DEFAULT_HOLIDAY_RULES],
    extraHolidays: [],
});

const sameSet = <T,>(a: readonly T[], b: readonly T[]): boolean =>
    a.length === b.length && a.every(v => b.includes(v));

// An empty dimension means "no restriction", so the chips for it render as
// implied-on. Clicking one from that state drops just that value — the chips
// look on, so a click reads as "not this one" — and a full selection collapses
// back to the unrestricted encoding.
const toggleWithin = (list: number[], value: number, size: number): number[] => {
    const next = list.length === 0
        ? Array.from({ length: size }, (_, i) => i).filter(v => v !== value)
        : list.includes(value)
            ? list.filter(v => v !== value)
            : [...list, value].sort((a, b) => a - b);
    // The encoding has no way to say "none", so refuse to empty an explicit
    // list; `All` is how you get back to unrestricted.
    if (next.length === 0) return list;
    return next.length === size ? [] : next;
};

// --- Small shared controls ---------------------------------------------------

type ChipTone = 'on' | 'implied' | 'off';

const CHIP_TONES: Record<ChipTone, string> = {
    on: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
    implied: 'bg-emerald-500/10 text-emerald-300/60 ring-1 ring-emerald-500/15',
    off: 'bg-white/5 text-slate-500 hover:bg-white/10 hover:text-slate-300',
};

function Chip({ tone, onClick, children, title }: {
    tone: ChipTone; onClick: () => void; children: React.ReactNode; title?: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            aria-pressed={tone !== 'off'}
            className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${CHIP_TONES[tone]}`}
        >
            {children}
        </button>
    );
}

function Shortcut({ active = false, onClick, children }: {
    active?: boolean; onClick: () => void; children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`text-xs transition-colors ${
                active ? 'text-emerald-400' : 'text-slate-500 hover:text-slate-300'
            }`}
        >
            {children}
        </button>
    );
}

function IconButton({ onClick, title, disabled, danger, children }: {
    onClick: () => void; title: string; disabled?: boolean; danger?: boolean;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            aria-label={title}
            disabled={disabled}
            className={`p-1 rounded-md text-slate-500 transition-colors shrink-0 hover:bg-white/5 disabled:opacity-25 disabled:pointer-events-none ${
                danger ? 'hover:text-red-400' : 'hover:text-slate-300'
            }`}
        >
            {children}
        </button>
    );
}

// Label + live summary of what the dimension currently resolves to, with its
// shortcuts right-aligned. The summary is what disambiguates the implied-on
// chips ("every day" vs. "all seven picked").
function Field({ label, summary, actions, children }: {
    label: string; summary: string; actions?: React.ReactNode; children: React.ReactNode;
}) {
    return (
        <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-xs text-slate-400 truncate">
                    {label}
                    <span className="text-slate-600 mx-1.5">·</span>
                    <span className="text-slate-500 font-mono">{summary}</span>
                </span>
                {actions && <div className="flex gap-2 shrink-0">{actions}</div>}
            </div>
            {children}
        </div>
    );
}

// A 24-cell hour strip. Press and drag paints hours in or out (the first cell
// decides which), and the selection is converted back to `HourRange`s —
// including a midnight wrap — on release, so the user never has to think about
// start/end ordering. An empty `ranges` is the unrestricted encoding and shows
// as a dimmed full day rather than an empty strip.
function HourStrip({ ranges, onChange }: {
    ranges: HourRange[];
    onChange: (ranges: HourRange[]) => void;
}) {
    const implied = ranges.length === 0;

    const selected = useMemo(() => {
        const set = new Set<number>();
        if (implied) {
            for (let h = 0; h < 24; h++) set.add(h);
            return set;
        }
        for (const r of ranges) {
            for (let h = 0; h < 24; h++) {
                const inRange = r.start <= r.end
                    ? h >= r.start && h <= r.end
                    : h >= r.start || h <= r.end;
                if (inRange) set.add(h);
            }
        }
        return set;
    }, [ranges, implied]);

    const [draft, setDraft] = useState<Set<number> | null>(null);
    const modeRef = useRef<'add' | 'remove'>('add');
    const trackRef = useRef<HTMLDivElement>(null);
    const view = draft ?? selected;

    const commit = (next: Set<number>) => {
        // "No hours" is not expressible — an empty `hourRanges` means every hour
        // — so a drag that clears the strip reverts instead of inverting itself.
        if (next.size === 0) return;
        if (next.size === 24) return onChange([]);

        const hours = [...next].sort((a, b) => a - b);
        const runs: HourRange[] = [];
        let start = hours[0];
        let prev = hours[0];
        for (const h of hours.slice(1)) {
            if (h === prev + 1) { prev = h; continue; }
            runs.push({ start, end: prev });
            start = h;
            prev = h;
        }
        runs.push({ start, end: prev });

        // Fold a run touching both ends of the day into one wrapping window,
        // which is how `isHourInRange` expects an overnight period to be stored.
        if (runs.length > 1 && runs[0].start === 0 && runs[runs.length - 1].end === 23) {
            const tail = runs.pop()!;
            runs[0] = { start: tail.start, end: runs[0].end };
        }
        onChange(runs);
    };

    const paint = (base: Set<number>, hour: number): Set<number> => {
        const adding = modeRef.current === 'add';
        if (base.has(hour) === adding) return base;
        const next = new Set(base);
        if (adding) next.add(hour); else next.delete(hour);
        return next;
    };

    const hourAt = (clientX: number): number => {
        const rect = trackRef.current?.getBoundingClientRect();
        if (!rect || rect.width === 0) return 0;
        const idx = Math.floor(((clientX - rect.left) / rect.width) * 24);
        return Math.max(0, Math.min(23, idx));
    };

    const handleDown = (e: React.PointerEvent) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const hour = hourAt(e.clientX);
        modeRef.current = selected.has(hour) ? 'remove' : 'add';
        trackRef.current?.setPointerCapture(e.pointerId);
        setDraft(paint(selected, hour));
    };

    const handleMove = (e: React.PointerEvent) => {
        if (!draft) return;
        const hour = hourAt(e.clientX);
        setDraft(prev => (prev ? paint(prev, hour) : prev));
    };

    const handleUp = () => {
        if (!draft) return;
        commit(draft);
        setDraft(null);
    };

    return (
        <div>
            <div
                ref={trackRef}
                className="flex gap-px touch-none select-none"
                onPointerDown={handleDown}
                onPointerMove={handleMove}
                onPointerUp={handleUp}
                onPointerCancel={handleUp}
            >
                {Array.from({ length: 24 }, (_, h) => (
                    <button
                        key={h}
                        type="button"
                        aria-label={`${formatHour12(h)} to ${formatExclusiveEnd(h)}`}
                        aria-pressed={view.has(h)}
                        title={`${formatHour12(h)} – ${formatExclusiveEnd(h)}`}
                        onKeyDown={e => {
                            if (e.key !== ' ' && e.key !== 'Enter') return;
                            e.preventDefault();
                            modeRef.current = selected.has(h) ? 'remove' : 'add';
                            commit(paint(selected, h));
                        }}
                        className={`flex-1 h-7 rounded-sm transition-colors ${
                            view.has(h)
                                ? implied && !draft
                                    ? 'bg-emerald-500/20 hover:bg-emerald-500/30'
                                    : 'bg-emerald-500/45 hover:bg-emerald-500/60'
                                : 'bg-white/5 hover:bg-white/10'
                        }`}
                    />
                ))}
            </div>
            <div className="flex justify-between mt-1">
                {[0, 6, 12, 18, 24].map(h => (
                    <span key={h} className="text-[10px] font-mono text-slate-600">
                        {formatHour12(h % 24)}
                    </span>
                ))}
            </div>
        </div>
    );
}

// --- Rule editor -------------------------------------------------------------

function RuleEditor({ rule, index, total, color, onChange, onDuplicate, onRemove }: {
    rule: PeakRule;
    index: number;
    total: number;
    color: string;
    onChange: (rule: PeakRule) => void;
    onDuplicate: () => void;
    onRemove: () => void;
}) {
    return (
        <div
            className="rounded-lg bg-sunken/60 border border-line border-l-2 p-3 flex flex-col gap-3"
            style={{ borderLeftColor: color }}
        >
            {total > 1 && (
                <div className="flex items-center justify-between gap-2 -mb-1">
                    <span className="text-[11px] font-medium text-slate-500">Rule {index + 1}</span>
                    <div className="flex items-center gap-0.5">
                        <IconButton onClick={onDuplicate} title="Duplicate this rule">
                            <CopyPlus className="w-3.5 h-3.5" />
                        </IconButton>
                        <IconButton onClick={onRemove} title="Remove this rule" danger>
                            <X className="w-3.5 h-3.5" />
                        </IconButton>
                    </div>
                </div>
            )}

            <Field
                label="Days"
                summary={describeDays(rule.daysOfWeek)}
                actions={
                    <>
                        <Shortcut
                            active={sameSet(rule.daysOfWeek, WEEKDAYS)}
                            onClick={() => onChange({ ...rule, daysOfWeek: [...WEEKDAYS] })}
                        >
                            Weekdays
                        </Shortcut>
                        <Shortcut
                            active={sameSet(rule.daysOfWeek, WEEKENDS)}
                            onClick={() => onChange({ ...rule, daysOfWeek: [...WEEKENDS] })}
                        >
                            Weekends
                        </Shortcut>
                        <Shortcut
                            active={rule.daysOfWeek.length === 0}
                            onClick={() => onChange({ ...rule, daysOfWeek: [] })}
                        >
                            All
                        </Shortcut>
                    </>
                }
            >
                <div className="grid grid-cols-7 gap-1">
                    {DAYS_OF_WEEK.map((label, d) => (
                        <Chip
                            key={d}
                            tone={rule.daysOfWeek.length === 0 ? 'implied' : rule.daysOfWeek.includes(d) ? 'on' : 'off'}
                            onClick={() => onChange({ ...rule, daysOfWeek: toggleWithin(rule.daysOfWeek, d, 7) })}
                        >
                            {label}
                        </Chip>
                    ))}
                </div>
            </Field>

            <Field
                label="Months"
                summary={describeMonths(rule.months)}
                actions={
                    <>
                        <Shortcut
                            active={sameSet(rule.months, SUMMER_MONTHS)}
                            onClick={() => onChange({ ...rule, months: [...SUMMER_MONTHS] })}
                        >
                            Summer
                        </Shortcut>
                        <Shortcut
                            active={sameSet(rule.months, WINTER_MONTHS)}
                            onClick={() => onChange({ ...rule, months: [...WINTER_MONTHS] })}
                        >
                            Winter
                        </Shortcut>
                        <Shortcut
                            active={rule.months.length === 0}
                            onClick={() => onChange({ ...rule, months: [] })}
                        >
                            All
                        </Shortcut>
                    </>
                }
            >
                <div className="grid grid-cols-6 gap-1">
                    {MONTHS.map((label, m) => (
                        <Chip
                            key={m}
                            tone={rule.months.length === 0 ? 'implied' : rule.months.includes(m) ? 'on' : 'off'}
                            onClick={() => onChange({ ...rule, months: toggleWithin(rule.months, m, 12) })}
                        >
                            {label}
                        </Chip>
                    ))}
                </div>
            </Field>

            <Field
                label="Hours"
                summary={describeHours(rule.hourRanges)}
                actions={
                    <Shortcut
                        active={rule.hourRanges.length === 0}
                        onClick={() => onChange({ ...rule, hourRanges: [] })}
                    >
                        All
                    </Shortcut>
                }
            >
                <HourStrip
                    ranges={rule.hourRanges}
                    onChange={hourRanges => onChange({ ...rule, hourRanges })}
                />
            </Field>
        </div>
    );
}

// --- Period editor -----------------------------------------------------------

function PeriodEditor({ period, index, total, onChange, onMove, onRemove }: {
    period: PeakPeriod;
    index: number;
    total: number;
    onChange: (period: PeakPeriod) => void;
    onMove: (delta: number) => void;
    onRemove: () => void;
}) {
    const color = PEAK_COLORS[period.colorKey];

    const setRule = (i: number, rule: PeakRule) =>
        onChange({ ...period, rules: period.rules.map((r, j) => (j === i ? rule : r)) });

    const addRule = (rule: PeakRule) =>
        onChange({ ...period, rules: [...period.rules, rule] });

    return (
        <div className="rounded-xl bg-surface-2 border border-line p-3 flex flex-col gap-3">
            <div className="flex items-center gap-2">
                {total > 1 && (
                    <span
                        title={index === 0 ? 'Checked first' : `Checked after ${index} other period${index > 1 ? 's' : ''}`}
                        className="w-5 h-5 shrink-0 grid place-items-center rounded-md bg-white/5 text-[10px] font-mono text-slate-500"
                    >
                        {index + 1}
                    </span>
                )}

                <div className="flex-1 min-w-0 flex items-center gap-2 bg-sunken border border-line rounded-lg px-2.5 py-1.5 focus-within:border-emerald-500/40 transition-colors">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                    <input
                        value={period.name}
                        onChange={e => onChange({ ...period, name: e.target.value })}
                        placeholder="Period name"
                        aria-label="Period name"
                        className="flex-1 min-w-0 bg-transparent text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none"
                    />
                </div>

                <div className="flex gap-1 shrink-0">
                    {PEAK_COLOR_KEYS.map(key => (
                        <button
                            key={key}
                            type="button"
                            title={`${key} — use this color`}
                            aria-label={`${key} color`}
                            aria-pressed={period.colorKey === key}
                            onClick={() => onChange({ ...period, colorKey: key })}
                            className={`w-4 h-4 rounded transition-transform ${
                                period.colorKey === key ? 'ring-2 ring-white/60 scale-110' : 'opacity-60 hover:opacity-100 hover:scale-110'
                            }`}
                            style={{ backgroundColor: PEAK_COLORS[key] }}
                        />
                    ))}
                </div>

                <div className="flex items-center gap-0.5 shrink-0">
                    {total > 1 && (
                        <>
                            <IconButton onClick={() => onMove(-1)} title="Check this period earlier" disabled={index === 0}>
                                <ChevronUp className="w-4 h-4" />
                            </IconButton>
                            <IconButton onClick={() => onMove(1)} title="Check this period later" disabled={index === total - 1}>
                                <ChevronDown className="w-4 h-4" />
                            </IconButton>
                        </>
                    )}
                    <IconButton onClick={onRemove} title="Remove this period" danger>
                        <Trash2 className="w-4 h-4" />
                    </IconButton>
                </div>
            </div>

            {period.rules.map((rule, i) => (
                <RuleEditor
                    key={i}
                    rule={rule}
                    index={i}
                    total={period.rules.length}
                    color={color}
                    onChange={next => setRule(i, next)}
                    onDuplicate={() => addRule({
                        hourRanges: rule.hourRanges.map(r => ({ ...r })),
                        daysOfWeek: [...rule.daysOfWeek],
                        months: [...rule.months],
                    })}
                    onRemove={() => onChange({ ...period, rules: period.rules.filter((_, j) => j !== i) })}
                />
            ))}

            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => addRule({ hourRanges: [{ start: 6, end: 8 }], daysOfWeek: [...WEEKDAYS], months: [] })}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-sunken text-slate-400 hover:bg-white/5 hover:text-slate-300 transition-colors"
                >
                    <Plus className="w-3.5 h-3.5" />
                    Add rule
                </button>
                <p className="text-[11px] text-slate-500 leading-snug">
                    Rules are OR'd — add one for a season with different hours.
                </p>
            </div>
        </div>
    );
}

// --- Preview -----------------------------------------------------------------

// A 24 x 7 grid for one representative month. TOU rules are easy to get subtly
// wrong and reading the grid makes the mistake obvious immediately.
function SchedulePreview({ schedule }: { schedule: PeakSchedule }) {
    const [month, setMonth] = useState(new Date().getMonth());

    const cells = useMemo(() => {
        // Holidays are date-specific and this grid is a generic week, so they are
        // excluded from the preview rather than shown against an arbitrary date.
        const index = buildPeakIndex({ ...schedule, observeHolidays: false });
        // Any Sunday inside the month works — only (month, day-of-week, hour)
        // reaches the classifier. Anchoring on the 7th guarantees the walk back
        // to Sunday (at most six days) stays inside the same month.
        const base = new Date(2024, month, 7);
        const sunday = new Date(base.getFullYear(), base.getMonth(), base.getDate() - base.getDay());
        return Array.from({ length: 7 }, (_, d) =>
            Array.from({ length: 24 }, (_, h) =>
                classify(new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + d, h).getTime() / 1000, index)));
    }, [schedule, month]);

    // Share of the week each period covers in the selected month — the quickest
    // read on "did that rule actually land where I meant it to".
    const shares = useMemo(() => {
        const counts = new Array(schedule.periods.length).fill(0) as number[];
        let offPeak = 0;
        for (const row of cells) {
            for (const idx of row) {
                if (idx === OFF_PEAK) offPeak++;
                else counts[idx] = (counts[idx] ?? 0) + 1;
            }
        }
        return { counts, offPeak };
    }, [cells, schedule.periods.length]);

    const pct = (hours: number) => `${Math.round((hours / HOURS_IN_WEEK) * 100)}%`;

    return (
        <div className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Preview</span>
                <span className="text-[11px] text-slate-500">A typical week in {MONTHS[month]}</span>
            </div>

            <div className="grid grid-cols-6 gap-1">
                {MONTHS.map((label, m) => (
                    <Chip key={m} tone={month === m ? 'on' : 'off'} onClick={() => setMonth(m)}>
                        {label}
                    </Chip>
                ))}
            </div>

            <div className="flex flex-col gap-px">
                {cells.map((row, d) => (
                    <div key={d} className="flex items-center gap-1.5">
                        <span className="w-7 shrink-0 text-[10px] font-mono text-slate-500">{DAYS_OF_WEEK[d]}</span>
                        <div className="flex-1 flex gap-px">
                            {row.map((periodIdx, h) => (
                                <div
                                    key={h}
                                    title={`${DAYS_OF_WEEK[d]} ${formatHour12(h)} – ${periodIdx === OFF_PEAK ? 'Off-peak' : schedule.periods[periodIdx].name}`}
                                    className={`flex-1 h-4 rounded-[2px] ${periodIdx === OFF_PEAK ? 'bg-white/5' : ''}`}
                                    style={periodIdx === OFF_PEAK
                                        ? undefined
                                        : { backgroundColor: PEAK_COLORS[schedule.periods[periodIdx].colorKey], opacity: 0.6 }}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <div className="flex justify-between pl-[2.125rem]">
                {[0, 6, 12, 18, 24].map(h => (
                    <span key={h} className="text-[10px] font-mono text-slate-600">{formatHour12(h % 24)}</span>
                ))}
            </div>

            <div className="flex h-1.5 rounded-full overflow-hidden bg-sunken mt-1">
                {schedule.periods.map((period, i) => (
                    <div
                        key={period.id}
                        title={`${period.name} — ${pct(shares.counts[i])}`}
                        style={{
                            width: `${(shares.counts[i] / HOURS_IN_WEEK) * 100}%`,
                            backgroundColor: PEAK_COLORS[period.colorKey],
                        }}
                    />
                ))}
            </div>

            <div className="flex flex-col gap-1">
                {schedule.periods.map((period, i) => (
                    <div key={period.id} className="flex items-center gap-2 text-xs">
                        <span
                            className="w-2.5 h-2.5 rounded-sm shrink-0"
                            style={{ backgroundColor: PEAK_COLORS[period.colorKey] }}
                        />
                        <span className="text-slate-300 truncate">{period.name || 'Untitled'}</span>
                        <div className="flex-1 min-w-0" />
                        <span className={`font-mono slashed-zero tabular-nums ${
                            shares.counts[i] === 0 ? 'text-amber-400/80' : 'text-slate-400'
                        }`}>
                            {shares.counts[i] === 0 ? 'none' : pct(shares.counts[i])}
                        </span>
                    </div>
                ))}
                <div className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0 bg-slate-600" />
                    <span className="text-slate-400">Off-peak</span>
                    <div className="flex-1 min-w-0" />
                    <span className="font-mono slashed-zero tabular-nums text-slate-500">{pct(shares.offPeak)}</span>
                </div>
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
                Observed holidays are off-peak and are not shown in this grid. Hours use your
                browser's timezone, which is only the meter's timezone if you are in it.
            </p>
        </div>
    );
}

// --- Holidays ----------------------------------------------------------------

function HolidaySettings({ schedule, update }: {
    schedule: PeakSchedule;
    update: (patch: Partial<PeakSchedule>) => void;
}) {
    const [open, setOpen] = useState(false);

    const toggleHoliday = (key: HolidayRuleKey) => {
        const current = schedule.holidayRules;
        update({ holidayRules: current.includes(key) ? current.filter(k => k !== key) : [...current, key] });
    };

    const extras = schedule.extraHolidays.length;
    const summary = `${schedule.holidayRules.length} of ${HOLIDAY_RULES.length} federal${
        extras ? ` · ${extras} custom` : ''
    }`;

    return (
        <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Holidays</span>

            <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                    type="checkbox"
                    checked={schedule.observeHolidays}
                    onChange={e => update({ observeHolidays: e.target.checked })}
                    className="accent-emerald-500"
                />
                Treat holidays as off-peak
            </label>

            {schedule.observeHolidays && (
                <>
                    <button
                        type="button"
                        onClick={() => setOpen(o => !o)}
                        aria-expanded={open}
                        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                    >
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                        {summary}
                    </button>

                    {open && (
                        <div className="flex flex-col gap-2 pl-1">
                            <div className="flex gap-2 justify-end">
                                <Shortcut
                                    active={schedule.holidayRules.length === HOLIDAY_RULES.length}
                                    onClick={() => update({ holidayRules: HOLIDAY_RULES.map(h => h.key) })}
                                >
                                    All
                                </Shortcut>
                                <Shortcut
                                    active={sameSet(schedule.holidayRules, DEFAULT_HOLIDAY_RULES)}
                                    onClick={() => update({ holidayRules: [...DEFAULT_HOLIDAY_RULES] })}
                                >
                                    Typical
                                </Shortcut>
                                <Shortcut
                                    active={schedule.holidayRules.length === 0}
                                    onClick={() => update({ holidayRules: [] })}
                                >
                                    None
                                </Shortcut>
                            </div>

                            <div className="grid grid-cols-1 gap-y-1">
                                {HOLIDAY_RULES.map(({ key, name }) => (
                                    <label key={key} className="flex items-center gap-2 text-xs text-slate-400">
                                        <input
                                            type="checkbox"
                                            checked={schedule.holidayRules.includes(key)}
                                            onChange={() => toggleHoliday(key)}
                                            className="accent-emerald-500"
                                        />
                                        {name}
                                    </label>
                                ))}
                            </div>

                            <label className="flex flex-col gap-1">
                                <span className="text-[11px] text-slate-500">
                                    Additional dates (YYYY-MM-DD, comma separated)
                                </span>
                                <input
                                    value={schedule.extraHolidays.join(', ')}
                                    onChange={e => update({
                                        extraHolidays: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
                                    })}
                                    placeholder="2025-12-24"
                                    className="bg-sunken border border-line rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/40"
                                />
                            </label>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

// --- Empty state -------------------------------------------------------------

function TemplatePicker({ onPick, onBlank }: {
    onPick: (schedule: PeakSchedule) => void;
    onBlank: () => void;
}) {
    // The color tiers a template ships with, so the cards preview their shape.
    const swatches = useMemo(
        () => PEAK_TEMPLATES.map(t => t.build().periods.map(p => p.colorKey)),
        [],
    );

    return (
        // Held to a readable column: the panel is sized for the two-pane editor
        // this picker leads into, which is far wider than these cards need.
        <div className="flex flex-col gap-3 w-full max-w-lg mx-auto">
            <p className="text-xs text-slate-500 leading-relaxed">
                Green Button files carry no rate-period metadata, so the schedule is yours to
                describe. It shades the chart as a visual reference — it does not recompute
                your bill.
            </p>

            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                Start from a template
            </span>

            <div className="flex flex-col gap-2">
                {PEAK_TEMPLATES.map((template, i) => (
                    <button
                        key={template.name}
                        type="button"
                        onClick={() => onPick(template.build())}
                        className="text-left rounded-lg bg-sunken border border-line px-3 py-2.5 hover:border-emerald-500/40 hover:bg-white/5 transition-colors"
                    >
                        <span className="flex items-center gap-2">
                            <span className="flex gap-1 shrink-0">
                                {swatches[i].map((key, j) => (
                                    <span
                                        key={j}
                                        className="w-2.5 h-2.5 rounded-sm"
                                        style={{ backgroundColor: PEAK_COLORS[key] }}
                                    />
                                ))}
                            </span>
                            <span className="text-sm text-slate-200">{template.name}</span>
                        </span>
                        <span className="block text-xs text-slate-500 mt-1">{template.description}</span>
                    </button>
                ))}
            </div>

            <button
                type="button"
                onClick={onBlank}
                className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-sunken text-slate-400 hover:bg-white/5 hover:text-slate-300 transition-colors"
            >
                <Plus className="w-3.5 h-3.5" />
                Start from scratch
            </button>
        </div>
    );
}

// --- Modal -------------------------------------------------------------------

interface PeakRatesModalProps {
    schedule: PeakSchedule | null;
    onChange: (schedule: PeakSchedule | null) => void;
    onClose: () => void;
    // Saves the loaded dataset as a native .json with this schedule embedded, so
    // re-loading that one file brings the rate periods back with the readings.
    // Absent when there is nothing loaded to save.
    onSaveDataFile?: () => void;
}

export function PeakRatesModal({ schedule, onChange, onClose, onSaveDataFile }: PeakRatesModalProps) {
    const modalRef = useRef<ModalHandle>(null);
    const [importOpen, setImportOpen] = useState(false);
    const [importText, setImportText] = useState('');
    const [importError, setImportError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [saved, setSaved] = useState(false);
    const [confirmClear, setConfirmClear] = useState(false);

    const periods = schedule?.periods ?? [];
    const hasPeriods = periods.length > 0;

    const nextColor = (): PeakColorKey =>
        PEAK_COLOR_KEYS[periods.length % PEAK_COLOR_KEYS.length];

    const update = (patch: Partial<PeakSchedule>) => onChange({ ...(schedule ?? emptySchedule()), ...patch });

    const setPeriod = (i: number, period: PeakPeriod) =>
        update({ periods: periods.map((p, j) => (j === i ? period : p)) });

    const movePeriod = (i: number, delta: number) => {
        const next = [...periods];
        const target = i + delta;
        if (target < 0 || target >= next.length) return;
        [next[i], next[target]] = [next[target], next[i]];
        update({ periods: next });
    };

    const addPeriod = () =>
        update({ periods: [...periods, newPeriod(`Period ${periods.length + 1}`, nextColor())] });

    const handleImport = () => {
        const parsed = parsePeakScheduleJson(importText);
        if (!parsed) {
            setImportError("That doesn't look like a peak schedule.");
            return;
        }
        onChange(parsed);
        setImportOpen(false);
        setImportText('');
        setImportError(null);
    };

    const handleSave = () => {
        onSaveDataFile?.();
        setSaved(true);
        window.setTimeout(() => setSaved(false), 1500);
    };

    const handleCopy = () => {
        if (!schedule) return;
        void navigator.clipboard?.writeText(JSON.stringify(schedule, null, 2));
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
    };

    const handleClear = () => {
        if (!confirmClear) {
            setConfirmClear(true);
            window.setTimeout(() => setConfirmClear(false), 3000);
            return;
        }
        setConfirmClear(false);
        onChange(null);
    };

    const headerSub = hasPeriods
        ? `${periods.length} period${periods.length === 1 ? '' : 's'} · ${
            schedule?.observeHolidays ? 'holidays off-peak' : 'holidays ignored'
        }`
        : 'Shades the chart as a visual reference';

    return (
        <Modal
            ref={modalRef}
            onClose={onClose}
            // Fixed width in both states: picking a template swaps the body's
            // contents, and the panel must not resize out from under the click.
            panelClassName="max-w-2xl lg:max-w-5xl max-h-[88vh]"
            ariaLabel="Peak rate periods"
        >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-header-line shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="bg-red-400/10 border border-red-400/25 p-1.5 rounded-lg shrink-0">
                        <CalendarClock className="w-4 h-4 text-red-400" />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-sm font-semibold text-slate-200">Peak rate periods</h2>
                        <p className="text-[11px] text-slate-500 truncate">{headerSub}</p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => modalRef.current?.close()}
                    className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-white/5 rounded-lg transition-colors shrink-0"
                    aria-label="Close"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Import — pinned under the header so it is visible wherever the
                panes happen to be scrolled. */}
            {importOpen && (
                <div className="px-4 py-3 border-b border-line bg-surface-2 flex flex-col gap-2 shrink-0">
                    <span className="text-xs text-slate-400">
                        Paste a schedule someone shared, or the contents of an exported data file.
                    </span>
                    <textarea
                        value={importText}
                        onChange={e => { setImportText(e.target.value); setImportError(null); }}
                        rows={4}
                        autoFocus
                        placeholder='{ "version": 1, "periods": [ … ] }'
                        className="bg-sunken border border-line rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/40"
                    />
                    {importError && <span className="text-xs text-red-400">{importError}</span>}
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={handleImport}
                            disabled={!importText.trim()}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                        >
                            Replace schedule
                        </button>
                        <button
                            type="button"
                            onClick={() => { setImportOpen(false); setImportError(null); }}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-300 transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Body: periods on the left, preview + schedule options on the right */}
            <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
                <div className="flex-1 min-w-0 lg:overflow-y-auto p-4 flex flex-col gap-3">
                    {!hasPeriods && (
                        <TemplatePicker
                            onPick={onChange}
                            onBlank={() => update({ periods: [newPeriod('On-Peak', 'red')] })}
                        />
                    )}

                    {hasPeriods && (
                        <>
                            <label className="flex flex-col gap-1">
                                <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                                    Schedule name
                                </span>
                                <input
                                    value={schedule?.label ?? ''}
                                    onChange={e => update({ label: e.target.value })}
                                    placeholder="e.g. “ComEd C&I — Rate 6”"
                                    className="bg-sunken border border-line rounded-lg px-2.5 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/40 transition-colors"
                                />
                            </label>

                            {periods.length > 1 && (
                                <p className="flex items-start gap-2 text-[11px] text-slate-500 leading-relaxed">
                                    <ListOrdered className="w-3.5 h-3.5 shrink-0 mt-px" />
                                    Checked top-down, first match wins — keep the narrowest tier (a
                                    critical peak) above the broader one it sits inside.
                                </p>
                            )}

                            {periods.map((period, i) => (
                                <PeriodEditor
                                    key={period.id}
                                    period={period}
                                    index={i}
                                    total={periods.length}
                                    onChange={next => setPeriod(i, next)}
                                    onMove={delta => movePeriod(i, delta)}
                                    onRemove={() => update({ periods: periods.filter((_, j) => j !== i) })}
                                />
                            ))}

                            <button
                                type="button"
                                onClick={addPeriod}
                                className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-sunken text-slate-400 hover:bg-white/5 hover:text-slate-300 transition-colors"
                            >
                                <Plus className="w-3.5 h-3.5" />
                                Add period
                            </button>
                        </>
                    )}
                </div>

                {schedule && hasPeriods && (
                    <aside className="shrink-0 lg:w-[22rem] border-t border-line lg:border-t-0 lg:border-l lg:overflow-y-auto p-4 flex flex-col gap-4 bg-surface-2/40">
                        <SchedulePreview schedule={schedule} />
                        <div className="border-t border-line pt-4">
                            <HolidaySettings schedule={schedule} update={update} />
                        </div>
                    </aside>
                )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-2 px-4 py-3 bg-sunken border-t border-header-line shrink-0">
                <button
                    type="button"
                    onClick={() => { setImportOpen(o => !o); setImportError(null); }}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        importOpen
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-300'
                    }`}
                >
                    <Upload className="w-3.5 h-3.5" />
                    Import
                </button>
                {schedule && (
                    <button
                        type="button"
                        onClick={handleCopy}
                        title="Copy this schedule as JSON to share it"
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-300 transition-colors"
                    >
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        {copied ? 'Copied' : 'Copy JSON'}
                    </button>
                )}
                {schedule && onSaveDataFile && (
                    <button
                        type="button"
                        onClick={handleSave}
                        title="Download this dataset as a .json file with the schedule saved inside it"
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-300 transition-colors"
                    >
                        {saved ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Download className="w-3.5 h-3.5" />}
                        <span className="hidden sm:inline">{saved ? 'Saved' : 'Save data file'}</span>
                    </button>
                )}
                <div className="flex-1" />
                {schedule && (
                    <button
                        type="button"
                        onClick={handleClear}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            confirmClear
                                ? 'bg-red-500/15 text-red-400'
                                : 'text-slate-500 hover:text-red-400'
                        }`}
                    >
                        {confirmClear ? 'Clear — are you sure?' : 'Clear schedule'}
                    </button>
                )}
                <button
                    type="button"
                    onClick={() => modalRef.current?.close()}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 transition-colors"
                >
                    Done
                </button>
            </div>
        </Modal>
    );
}
