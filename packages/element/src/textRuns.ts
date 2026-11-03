import {
  SVG_NS,
  applyDarkModeFilter,
  getFontFamilyString,
  getFontString,
  isRTL,
} from "@excalidraw/common";

import { getCodeStyles, isCodeElement } from "./code";
import { getLineWidth } from "./textMeasurements";

import type { RenderEnvironment } from "./renderEnvironment";
import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
  FontString,
} from "./types";

/**
 * Inline text styles never change a letter's width: bold is a stroke along
 * the glyphs, not a bold font.
 */
export type TextStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  background?: string;
};

/** a styled range of `originalText`, in UTF-16 code units */
export type TextMark = TextStyle & { start: number; end: number };

export type TextRun = {
  text: string;
  style: TextStyle;
  x: number;
  width: number;
};

const STYLE_KEYS = [
  "bold",
  "italic",
  "underline",
  "strike",
  "color",
  "background",
] as const;

const BOLD_STROKE = 1 / 28;
const LINE_THICKNESS = 1 / 16;
/** where the lines are drawn, from the baseline, in font sizes */
const LINE_STYLES = [
  ["underline", 0.12],
  ["strike", -0.3],
] as const;

export const getTextMarks = (label: ExcalidrawTextElement): TextMark[] =>
  label.customData?.marks ?? [];

/** whether a text is drawn run by run: it has marks, or is a code block's */
export const hasTextStyles = (
  label: ExcalidrawTextElement,
  container: ExcalidrawElement | null,
) =>
  isCodeElement(container) ||
  (getTextMarks(label).length > 0 && !isRTL(label.text));

const sameStyle = (a: TextStyle, b: TextStyle) =>
  STYLE_KEYS.every((key) => (a[key] || undefined) === (b[key] || undefined));

/** a style per UTF-16 unit: the marks over the base styles */
const getCharStyles = (
  marks: readonly TextMark[],
  length: number,
  base?: TextStyle[] | null,
) => {
  const styles = Array.from({ length }, (_, i): TextStyle => base?.[i] ?? {});
  for (const { start, end, ...style } of marks) {
    for (let i = start; i < Math.min(end, length); i++) {
      styles[i] = { ...styles[i], ...style };
    }
  }
  return styles;
};

const toMarks = (styles: TextStyle[]) => {
  const marks: TextMark[] = [];
  styles.forEach((style, i) => {
    const clean: TextStyle = Object.fromEntries(
      Object.entries(style).filter(([, value]) => value),
    );
    if (!Object.keys(clean).length) {
      return;
    }
    const last = marks[marks.length - 1];
    if (last?.end === i && sameStyle(last, clean)) {
      last.end = i + 1;
    } else {
      marks.push({ ...clean, start: i, end: i + 1 });
    }
  });
  return marks;
};

/** the marks with `patch` applied to a range (a null patch clears it) */
export const patchTextMarks = (
  marks: readonly TextMark[],
  length: number,
  start: number,
  end: number,
  patch: TextStyle | null,
) => {
  const styles = getCharStyles(marks, length);
  for (let i = start; i < end; i++) {
    styles[i] = patch ? { ...styles[i], ...patch } : {};
  }
  return toMarks(styles);
};

/** the styles all of a range has */
export const getActiveTextStyle = (
  marks: readonly TextMark[],
  length: number,
  start: number,
  end: number,
) => {
  const styles = getCharStyles(marks, length).slice(start, end);
  return Object.fromEntries(
    STYLE_KEYS.filter(
      (key) =>
        styles[0]?.[key] && styles.every((s) => s[key] === styles[0][key]),
    ).map((key) => [key, styles[0][key]]),
  ) as TextStyle;
};

/**
 * The marks after a text change, found as the text between the common
 * prefix and suffix: typed text takes the style of the character before the
 * caret, a replacement the style of the first character it replaces.
 */
export const shiftTextMarks = (
  marks: readonly TextMark[],
  prev: string,
  next: string,
) => {
  const max = Math.min(prev.length, next.length);
  let prefix = 0;
  while (prefix < max && prev[prefix] === next[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < max - prefix &&
    prev[prev.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++;
  }
  const styles = getCharStyles(marks, prev.length);
  const inherited =
    (prefix < prev.length - suffix ? styles[prefix] : styles[prefix - 1]) ?? {};
  return toMarks([
    ...styles.slice(0, prefix),
    ...Array.from({ length: next.length - prefix - suffix }, () => inherited),
    ...styles.slice(prev.length - suffix),
  ]);
};

const getRunFont = (label: ExcalidrawTextElement, style: TextStyle) =>
  `${style.italic ? "italic " : ""}${getFontString(label)}` as FontString;

/**
 * A text as lines of positioned runs of one style each, or null for plain
 * text. A code block's syntax colors lie under the user's marks.
 */
export const getTextRuns = (
  label: ExcalidrawTextElement,
  container: ExcalidrawElement | null,
  env?: RenderEnvironment,
) => {
  if (!hasTextStyles(label, container)) {
    return null;
  }
  const original = label.originalText;
  const styles = getCharStyles(
    getTextMarks(label),
    original.length,
    getCodeStyles(label, container),
  );

  const lines: TextRun[][] = [[]];
  let index = 0;
  for (const char of label.text) {
    // wrapping only breaks lines, dropping the spaces it breaks at
    while (
      index < original.length &&
      !original.startsWith(char, index) &&
      /\s/.test(original[index])
    ) {
      index++;
    }
    const matched = original.startsWith(char, index);
    const style = matched ? styles[index] : {};
    if (matched) {
      index += char.length;
    }
    if (char === "\n") {
      lines.push([]);
      continue;
    }
    const line = lines[lines.length - 1];
    const last = line[line.length - 1];
    if (last && sameStyle(last.style, style)) {
      last.text += char;
    } else {
      line.push({ text: char, style, x: 0, width: 0 });
    }
  }

  for (const line of lines) {
    for (const run of line) {
      run.width = getLineWidth(run.text, getRunFont(label, run.style), env);
    }
    const width = line.reduce((sum, run) => sum + run.width, 0);
    // code is always left aligned
    let x = isCodeElement(container)
      ? 0
      : label.textAlign === "center"
      ? (label.width - width) / 2
      : label.textAlign === "right"
      ? label.width - width
      : 0;
    for (const run of line) {
      run.x = x;
      x += run.width;
    }
  }
  return lines;
};

export const drawTextRuns = (
  context: CanvasRenderingContext2D,
  label: ExcalidrawTextElement,
  lines: TextRun[][],
  lineHeightPx: number,
  verticalOffset: number,
  isDark: boolean,
) => {
  context.textAlign = "left";
  context.lineJoin = "round";
  lines.forEach((runs, index) => {
    const top = index * lineHeightPx;
    const y = top + verticalOffset;
    for (const { style, x, width } of runs) {
      if (style.background) {
        context.fillStyle = applyDarkModeFilter(style.background, isDark);
        context.fillRect(x, top, width, lineHeightPx);
      }
    }
    for (const { text, style, x, width } of runs) {
      const color = applyDarkModeFilter(
        style.color ?? label.strokeColor,
        isDark,
      );
      context.font = getRunFont(label, style);
      context.fillStyle = color;
      context.strokeStyle = color;
      context.fillText(text, x, y);
      if (style.bold) {
        context.lineWidth = label.fontSize * BOLD_STROKE;
        context.strokeText(text, x, y);
      }
      for (const [key, offset] of LINE_STYLES) {
        if (style[key]) {
          const thickness = label.fontSize * LINE_THICKNESS;
          context.fillRect(
            x,
            y + label.fontSize * offset - thickness / 2,
            width,
            thickness,
          );
        }
      }
    }
  });
};

export const appendTextRunsSvg = (
  node: SVGElement,
  label: ExcalidrawTextElement,
  lines: TextRun[][],
  lineHeightPx: number,
  verticalOffset: number,
  isDark: boolean,
) => {
  const make = (name: string, attrs: Record<string, string | number>) => {
    const el = node.ownerDocument.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, `${value}`);
    }
    return el;
  };
  lines.forEach((runs, index) => {
    const top = index * lineHeightPx;
    const y = top + verticalOffset;
    const text = make("text", {
      y,
      "font-family": getFontFamilyString(label),
      "font-size": `${label.fontSize}px`,
      fill: applyDarkModeFilter(label.strokeColor, isDark),
      "text-anchor": "start",
      style: "white-space: pre;",
      direction: "ltr",
      "dominant-baseline": "alphabetic",
    });
    const backgrounds: SVGElement[] = [];
    const lineNodes: SVGElement[] = [];
    for (const run of runs) {
      const { style, x, width } = run;
      const color = applyDarkModeFilter(
        style.color ?? label.strokeColor,
        isDark,
      );
      if (style.background) {
        backgrounds.push(
          make("rect", {
            x,
            y: top,
            width,
            height: lineHeightPx,
            fill: applyDarkModeFilter(style.background, isDark),
          }),
        );
      }
      const tspan = make("tspan", { x });
      tspan.textContent = run.text;
      if (style.color) {
        tspan.setAttribute("fill", color);
      }
      if (style.italic) {
        tspan.setAttribute("font-style", "italic");
      }
      if (style.bold) {
        tspan.setAttribute("stroke", color);
        tspan.setAttribute("stroke-width", `${label.fontSize * BOLD_STROKE}`);
        tspan.setAttribute("stroke-linejoin", "round");
      }
      text.appendChild(tspan);
      for (const [key, offset] of LINE_STYLES) {
        if (style[key]) {
          const lineY = y + label.fontSize * offset;
          lineNodes.push(
            make("line", {
              x1: x,
              y1: lineY,
              x2: x + width,
              y2: lineY,
              stroke: color,
              "stroke-width": label.fontSize * LINE_THICKNESS,
            }),
          );
        }
      }
    }
    node.append(...backgrounds, text, ...lineNodes);
  });
};
