"use client";

/**
 * The reading sheet — the panel that opens from the ≡ while a book is open.
 *
 * This replaces roughly 430 lines of imperative code in
 * overrides/book-art/fullscreen-bundle.js and ~1,200 lines of CSS that fought it
 * with 440 `!important` declarations across the file.
 *
 * The old version had no access to the reader's state, so it read the DOM and
 * wrote back by clicking hidden buttons:
 *
 *   - theme came from `.theme-options button.active`
 *   - reading mode from `.reader-modes button[aria-pressed]`
 *   - text size by clicking buttons found via aria-label string matching
 *   - the table of contents by cloning a <select>'s options
 *
 * Every one of those is a silent-failure path. A renamed class, a reworded
 * aria-label or a React re-render produced a control that did nothing and
 * reported nothing. That is exactly what happened with the text-size buttons:
 * `native('Decrease text size')` matched by equality while React rendered
 * "Decrease text size (100%)", so the lookup returned undefined and the tap was
 * swallowed with no error.
 *
 * Here the state arrives as props and changes leave as callbacks. There is no
 * DOM query, no string matching, and no `!important`.
 *
 * Read Aloud is the exception, and deliberately so: it lives in read-aloud.js
 * and already exposes a proper function API on `window`. Calling that is sound —
 * it is a module boundary, not a DOM hack — so this component calls it directly
 * instead of clicking a hidden `.rr-listen` button. Absent TTS, the section
 * simply does not render.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./reading-sheet.module.css";

export type SheetTheme = "light" | "sepia" | "dark";
export type SheetMode = "pages" | "scroll";
export type PageTurn = "none" | "slide";

/** A chapter in the book's table of contents. */
export type SheetTocItem = { label: string; value: string; current?: boolean };

/**
 * Read Aloud's public surface. Mirrors the window.rr* functions read-aloud.js
 * installs; BookReader adapts them so this component never touches globals.
 */
export type ReadAloudApi = {
  playing: boolean;
  paused: boolean;
  rate: number;
  sleepMinutes: number;
  canPrevious: boolean;
  canNext: boolean;
  voices: { label: string; value: string; current: boolean }[];
  toggle: () => void;
  stop: () => void;
  skip: () => void;
  previous: () => void;
  adjustSleep: (minutes: number) => void;
  setRate: (rate: number) => void;
  setVoice: (value: string) => void;
};

export type ReadingSheetProps = {
  open: boolean;
  onClose: () => void;

  theme: SheetTheme;
  onThemeChange: (theme: SheetTheme) => void;

  /** Absent for PDFs and comics, which have no reflowable text. */
  mode?: SheetMode;
  onModeChange?: (mode: SheetMode) => void;

  pageTurn?: PageTurn;
  onPageTurnChange?: (value: PageTurn) => void;

  fontSize?: number;
  onFontSizeChange?: (size: number) => void;

  lineHeight?: number;
  onLineHeightChange?: (value: number) => void;

  margin?: number;
  onMarginChange?: (value: number) => void;

  toc?: SheetTocItem[];
  onTocSelect?: (value: string) => void;
  /** Whole-book position, already formatted, e.g. "42%" or "Page 8 of 12". */
  progressLabel?: string;

  onSearch?: () => void;
  onBookmarks?: () => void;
  onShare?: () => void;

  /* Typography, moved out of the override in 1c-i. */
  fontFamily?: string;
  fontFamilies?: string[];
  onFontFamilyChange?: (key: string) => void;
  bold?: boolean;
  onBoldChange?: (on: boolean) => void;
  justify?: boolean;
  onJustifyChange?: (on: boolean) => void;
  charSpacing?: number;
  onCharSpacingChange?: (value: number) => void;
  wordSpacing?: number;
  onWordSpacingChange?: (value: number) => void;
  onReset?: () => void;

  readAloud?: ReadAloudApi;
};

/**
 * Which panel is showing. A plain union rather than free strings: the old code
 * used `view = name` with a DEPTH lookup keyed by the same strings, so a typo in
 * either place produced a view that rendered only its heading.
 */
type View = "menu" | "contents" | "text" | "advanced" | "aloud" | "voice";

/** Depth drives the slide direction, so movement says where you went. */
const DEPTH: Record<View, number> = {
  menu: 0, contents: 1, text: 1, aloud: 1, advanced: 2, voice: 2,
};

const THEMES: { value: SheetTheme; label: string; swatch: string; ink: string }[] = [
  { value: "light", label: "Light", swatch: "#ffffff", ink: "#222222" },
  { value: "sepia", label: "Sepia", swatch: "#f4e8ce", ink: "#433526" },
  { value: "dark", label: "Dark", swatch: "#191919", ink: "#dddddd" },
];

const FONT_MIN = 75;
const FONT_MAX = 160;
const FONT_STEP = 10;

/** Icons live here rather than as ASCII stand-ins, which read as placeholders. */
const Icon = ({ name }: { name: string }) => {
  const paths: Record<string, ReactNode> = {
    contents: <path d="M4 6h2M9 6h11M4 12h2M9 12h11M4 18h2M9 18h11" />,
    search: <><circle cx="11" cy="11" r="6" /><path d="M15.5 15.5 20 20" /></>,
    text: <path d="M4 6h16M4 12h10M4 18h13" />,
    bookmark: <path d="M7 4h10v16l-5-4-5 4Z" />,
    play: <path d="M7 4.5v15l12-7.5Z" fill="currentColor" stroke="none" />,
    stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none" />,
    pause: <path d="M8 5v14M16 5v14" />,
    previous: <><path d="M6 5v14" /><path d="m17 6-7 6 7 6" /></>,
    next: <><path d="M18 5v14" /><path d="m7 6 7 6-7 6" /></>,
    back: <path d="M14 6l-6 6 6 6" />,
    chevron: <path d="M9 6l6 6-6 6" />,
    gear: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></>,
    voice: <path d="M12 3v18M8 7v10M16 7v10M4 10v4M20 10v4" />,
    smaller: <><path d="M4 18 9.2 6h1.6L16 18M6.1 13h7.8" /><path d="M18 9h4" /></>,
    larger: <><path d="M2 18 7.2 6h1.6L14 18M4.1 13h7.8" /><path d="M16 9h6M19 6v6" /></>,
    pages: <><path d="M5 4.5h10a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2Z" /><path d="M9 4.5v15" /></>,
    scroll: <><rect x="5" y="3.5" width="14" height="17" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    motionOff: <><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M4 4l16 16" /></>,
    motionSlide: <><rect x="3.5" y="5" width="11" height="14" rx="2" /><path d="M12 8.5 16 12l-4 3.5M16 12h5" /></>,
    minus: <path d="M5 12h14" />,
    plus: <path d="M12 5v14M5 12h14" />,
    share: <><path d="M12 16V4M8 8l4-4 4 4" /><path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></>,
    reset: <><path d="M5 8a8 8 0 1 1-1 7" /><path d="M5 3v5h5" /></>,
  };
  return (
    <span className={styles.icon} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
    </span>
  );
};

function SheetHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className={styles.header}>
      <strong>{title}</strong>
      <button type="button" className={styles.headerButton}
        onClick={onBack} aria-label="Back to reading menu">
        <Icon name="back" />
      </button>
    </header>
  );
}

function SheetRow({ label, onClick, icon, detail, primary, danger }: {
  label: string; onClick: () => void; icon?: string;
  detail?: string; primary?: boolean; danger?: boolean;
}) {
  return (
    <button type="button" onClick={onClick}
      className={[styles.row, primary && styles.primary, danger && styles.danger]
        .filter(Boolean).join(" ")}>
      <span className={styles.rowLabel}>{label}</span>
      {detail && <span className={styles.rowDetail}>{detail}</span>}
      {icon && <Icon name={icon} />}
    </button>
  );
}

function SheetToggle({ label, on, onChange }: {
  label: string; on: boolean; onChange: (on: boolean) => void;
}) {
  return (
    <button type="button" role="switch" aria-checked={on}
      className={[styles.row, on && styles.current].filter(Boolean).join(" ")}
      onClick={() => onChange(!on)}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowDetail}>{on ? "On" : "Off"}</span>
    </button>
  );
}

export default function ReadingSheet(props: ReadingSheetProps) {
  const { open, onClose, theme, onThemeChange } = props;
  const [view, setView] = useState<View>("menu");
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const panelRef = useRef<HTMLElement | null>(null);

  const go = useCallback((next: View) => {
    setDirection(DEPTH[next] < DEPTH[view] ? "back" : "forward");
    setView(next);
  }, [view]);

  // Closing resets the navigation stack, so every future opening starts at the
  // root without an effect that synchronously sets state after render.
  const close = useCallback(() => {
    setView("menu");
    setDirection("forward");
    onClose();
  }, [onClose]);

  // Escape steps back one level, then closes — matching the ‹ button, so the two
  // never disagree.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (view === "menu") close(); else go("menu");
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, view, close, go]);

  if (!open) return null;

  const reflowable = props.mode !== undefined;
  const aloud = props.readAloud;

  return (
    <section
      ref={panelRef}
      className={styles.sheet}
      data-view={view}
      data-direction={direction}
      role="dialog"
      aria-modal="false"
      aria-label={view === "menu" ? "Reading menu" : view}
    >
      {view === "menu" && (
        <>
          {props.toc && props.toc.length > 0 && (
            <SheetRow label={`Contents${props.progressLabel ? ` · ${props.progressLabel}` : ""}`}
              icon="chevron" onClick={() => go("contents")} />
          )}
          <div className={styles.toolbar}>
            {props.onSearch && (
              <button type="button" className={styles.tile} onClick={props.onSearch}>
                <Icon name="search" /><span>Search</span>
              </button>
            )}
            {aloud && (
              <button type="button" className={styles.tile} onClick={() => go("aloud")}>
                <Icon name="play" /><span>Aloud</span>
              </button>
            )}
            {props.onBookmarks && (
              <button type="button" className={styles.tile} onClick={props.onBookmarks}>
                <Icon name="bookmark" /><span>Marks</span>
              </button>
            )}
            <button type="button" className={styles.tile} onClick={() => go("text")}>
              <Icon name="text" /><span>Text</span>
            </button>
          </div>
        </>
      )}

      {view === "contents" && (
        <>
          <SheetHeader title="Contents" onBack={() => go("menu")} />
          <div className={styles.scroller}>
            {props.toc?.map((item) => (
              <button key={item.value} type="button"
                className={[styles.row, styles.tocRow, item.current && styles.current]
                  .filter(Boolean).join(" ")}
                aria-current={item.current ? "location" : undefined}
                onClick={() => { props.onTocSelect?.(item.value); close(); }}>
                <span className={styles.rowLabel}>{item.label}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {view === "text" && (
        <>
          <SheetHeader title="Text" onBack={() => go("menu")} />

          {reflowable && props.fontSize !== undefined && (
            <div className={styles.stepper} role="group" aria-label="Text size">
              <button type="button"
                disabled={props.fontSize <= FONT_MIN}
                onClick={() => props.onFontSizeChange?.(Math.max(FONT_MIN, props.fontSize! - FONT_STEP))}
                aria-label={`Smaller text, currently ${props.fontSize}%`}><Icon name="smaller" /></button>
              <span className={styles.stepperValue}>{props.fontSize}%</span>
              <button type="button"
                disabled={props.fontSize >= FONT_MAX}
                onClick={() => props.onFontSizeChange?.(Math.min(FONT_MAX, props.fontSize! + FONT_STEP))}
                aria-label={`Larger text, currently ${props.fontSize}%`}><Icon name="larger" /></button>
            </div>
          )}

          {/* Swatches are circles and carry no label: a circle says "colour
              choice", and dropping the text also removes the font mismatch that
              labelled swatches caused. The name stays as the accessible name. */}
          <div className={styles.swatches} role="radiogroup" aria-label="Reading theme">
            {THEMES.map((option) => (
              <button key={option.value} type="button" role="radio"
                aria-checked={theme === option.value}
                aria-label={option.label}
                title={option.label}
                className={styles.swatch}
                style={{ background: option.swatch, color: option.ink }}
                onClick={() => onThemeChange(option.value)} />
            ))}
          </div>

          {reflowable && props.mode && (
            <div className={styles.segment} role="radiogroup" aria-label="Reading mode">
              {(["pages", "scroll"] as SheetMode[]).map((value) => (
                <button key={value} type="button" role="radio"
                  aria-checked={props.mode === value}
                  onClick={() => props.onModeChange?.(value)}>
                  <Icon name={value === "pages" ? "pages" : "scroll"} />
                  {value === "pages" ? "Pages" : "Scroll"}
                </button>
              ))}
            </div>
          )}

          {props.pageTurn !== undefined && props.mode === "pages" && (
            <>
              <span className={styles.groupLabel}>Page animation</span>
              <div className={styles.segment} role="radiogroup" aria-label="Page animation">
                {(["none", "slide"] as PageTurn[]).map((value) => (
                  <button key={value} type="button" role="radio"
                    aria-checked={props.pageTurn === value}
                    onClick={() => props.onPageTurnChange?.(value)}>
                    <Icon name={value === "none" ? "motionOff" : "motionSlide"} />
                    {value === "none" ? "None" : "Slide"}
                  </button>
                ))}
              </div>
            </>
          )}

          {reflowable && <SheetRow label="More options" icon="gear" onClick={() => go("advanced")} />}
        </>
      )}

      {view === "advanced" && (
        <>
          <SheetHeader title="More options" onBack={() => go("menu")} />
          {props.fontFamily !== undefined && props.fontFamilies && (
            <label className={styles.selectRow}>
              <span>Font</span>
              <select value={props.fontFamily}
                onChange={(event) => props.onFontFamilyChange?.(event.target.value)}>
                {props.fontFamilies.map((family) => <option key={family}>{family}</option>)}
              </select>
            </label>
          )}
          {props.bold !== undefined && props.onBoldChange && (
            <SheetToggle label="Bold text" on={props.bold} onChange={props.onBoldChange} />
          )}
          {props.lineHeight !== undefined && (
            <label className={styles.slider}>
              <span>Line spacing</span>
              <input type="range" min={1.35} max={2} step={0.05} value={props.lineHeight}
                onChange={(event) => props.onLineHeightChange?.(Number(event.target.value))} />
              <output>{props.lineHeight.toFixed(2)}</output>
            </label>
          )}
          {props.margin !== undefined && (
            <label className={styles.slider}>
              <span>Margins</span>
              <input type="range" min={2} max={12} step={1} value={props.margin}
                onChange={(event) => props.onMarginChange?.(Number(event.target.value))} />
              <output>{props.margin}</output>
            </label>
          )}
          {props.charSpacing !== undefined && (
            <label className={styles.slider}>
              <span>Character spacing</span>
              <input type="range" min={-1} max={6} step={0.1} value={props.charSpacing}
                onChange={(event) => props.onCharSpacingChange?.(Number(event.target.value))} />
              <output>{props.charSpacing.toFixed(1)}</output>
            </label>
          )}
          {props.wordSpacing !== undefined && (
            <label className={styles.slider}>
              <span>Word spacing</span>
              <input type="range" min={-2} max={18} step={0.5} value={props.wordSpacing}
                onChange={(event) => props.onWordSpacingChange?.(Number(event.target.value))} />
              <output>{props.wordSpacing.toFixed(1)}</output>
            </label>
          )}
          {props.justify !== undefined && props.onJustifyChange && (
            <SheetToggle label="Justify text" on={props.justify} onChange={props.onJustifyChange} />
          )}
          {props.onReset && <SheetRow label="Reset reading appearance" icon="reset" onClick={props.onReset} />}
          {props.onShare && <SheetRow label="Share book" icon="share" onClick={props.onShare} />}
        </>
      )}

      {view === "aloud" && aloud && (
        <>
          <SheetHeader title="Read Aloud" onBack={() => go("menu")} />
          {!aloud.playing ? (
            <SheetRow primary label="Start reading" icon="play" onClick={aloud.toggle} />
          ) : (
            <div className={styles.transport}>
              <button type="button" onClick={aloud.previous} disabled={!aloud.canPrevious}
                aria-label="Previous sentence">
                <Icon name="previous" /><span>Previous</span>
              </button>
              <button type="button" className={styles.transportMain} onClick={aloud.toggle}
                aria-label={aloud.paused ? "Resume reading" : "Pause reading"}>
                <Icon name={aloud.paused ? "play" : "pause"} /><span>{aloud.paused ? "Resume" : "Pause"}</span>
              </button>
              <button type="button" onClick={aloud.skip} disabled={!aloud.canNext}
                aria-label="Next sentence">
                <Icon name="next" /><span>Next</span>
              </button>
            </div>
          )}
          {aloud.voices.length > 0 && (
            <SheetRow label={aloud.voices.find((v) => v.current)?.label ?? "Default voice"}
              icon="chevron" onClick={() => go("voice")} />
          )}
          <label className={styles.rateCard}>
            <span className={styles.rateHeader}><span>Reading speed</span><output>{aloud.rate.toFixed(1)}×</output></span>
            <input type="range" min={0.5} max={2} step={0.1} value={aloud.rate}
              aria-label="Reading speed"
              onChange={(event) => aloud.setRate(Number(event.target.value))} />
            <span className={styles.rateBounds}><span>0.5×</span><span>2×</span></span>
          </label>
          {aloud.playing && (
            <>
              <div className={styles.sleepStepper} role="group" aria-label="Sleep timer">
                <span>Sleep timer</span>
                <button type="button" onClick={() => aloud.adjustSleep(-30)}
                  disabled={aloud.sleepMinutes <= 0} aria-label="Subtract 30 minutes"><Icon name="minus" /></button>
                <output aria-live="polite">{aloud.sleepMinutes > 0 ? `${aloud.sleepMinutes} min` : "Off"}</output>
                <button type="button" onClick={() => aloud.adjustSleep(30)}
                  aria-label="Add 30 minutes"><Icon name="plus" /></button>
              </div>
              <SheetRow danger label="Stop reading" icon="stop" onClick={aloud.stop} />
            </>
          )}
        </>
      )}

      {view === "voice" && aloud && (
        <>
          <SheetHeader title="Voice" onBack={() => go("menu")} />
          <div className={styles.scroller}>
            {aloud.voices.map((voice) => (
              <button key={voice.value} type="button"
                className={[styles.row, voice.current && styles.current].filter(Boolean).join(" ")}
                aria-current={voice.current ? "true" : undefined}
                onClick={() => { aloud.setVoice(voice.value); go("aloud"); }}>
                <span className={styles.rowLabel}>{voice.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
