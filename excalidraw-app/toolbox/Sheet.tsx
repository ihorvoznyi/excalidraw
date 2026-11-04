import {
  COLOR_PALETTE,
  ROUGHNESS,
  ROUNDNESS,
  applyDarkModeFilter,
  normalizeLink,
} from "@excalidraw/common";
import { useExcalidrawAPI } from "@excalidraw/excalidraw";
import {
  BoldIcon,
  HighlightIcon,
  ItalicIcon,
  LinkIcon,
  StrikethroughIcon,
  TextAlignCenterIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
  TextIcon,
  UnderlineIcon,
} from "@excalidraw/excalidraw/components/icons";
import {
  CaptureUpdateAction,
  newElementWith,
  newEmbeddableElement,
  parseMarkdownLinks,
} from "@excalidraw/element";
import clsx from "clsx";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { ExcalidrawEmbeddableElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  columnName,
  createEvaluator,
  formatValue,
  getRatesVersion,
  subscribeToRates,
} from "./sheetFormula";

import "./Sheet.scss";

import type { NumberFormat } from "./sheetFormula";

type CellStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  background?: string;
  align?: "left" | "center" | "right";
  format?: NumberFormat;
};

type Cell = { value?: string; link?: string; style?: CellStyle };
type Point = { r: number; c: number };
type Range = { top: number; left: number; bottom: number; right: number };

type SheetData = {
  rows: number;
  cols: number;
  cells: Record<string, Cell>;
  colWidths: Record<number, number>;
  rowHeights: Record<number, number>;
  merges: Range[];
};

const WIDTH = 720;
const HEIGHT = 420;
const COLUMN_WIDTH = 100;
const ROW_HEIGHT = 24;
const MIN_SIZE = 20;
// must match the headers' size in Sheet.scss
const HEADER_WIDTH = 44;
const HEADER_HEIGHT = 24;
const MAX_DECIMALS = 10;
const CURRENCIES = ["USD", "EUR", "GBP", "UAH", "PLN"];
const LINK_COLOR = "#2c61a1";
const BARE_URL = /^https?:\/\/\S+$/;

const HUES = [
  "gray",
  "red",
  "pink",
  "grape",
  "violet",
  "blue",
  "cyan",
  "teal",
  "green",
  "yellow",
  "orange",
  "bronze",
] as const;
const SHADES = [0, 1, 2, 3, 4] as const;

const COLOR_TOOLS = [
  { key: "color", icon: TextIcon, title: "Text color", none: "Automatic" },
  { key: "background", icon: HighlightIcon, title: "Fill color", none: "None" },
] as const;

const FONT_STYLES = [
  { key: "bold", icon: BoldIcon, title: "Bold" },
  { key: "italic", icon: ItalicIcon, title: "Italic" },
  { key: "underline", icon: UnderlineIcon, title: "Underline" },
  { key: "strike", icon: StrikethroughIcon, title: "Strikethrough" },
] as const;

const ALIGNMENTS = [
  { align: "left", icon: TextAlignLeftIcon, title: "Align left" },
  { align: "center", icon: TextAlignCenterIcon, title: "Align center" },
  { align: "right", icon: TextAlignRightIcon, title: "Align right" },
] as const;

const SHORTCUTS: Record<string, "bold" | "italic" | "underline"> = {
  b: "bold",
  i: "italic",
  u: "underline",
};

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

const cellId = ({ r, c }: Point) => `${columnName(c)}${r + 1}`;

const toRange = (a: Point, b: Point): Range => ({
  top: Math.min(a.r, b.r),
  left: Math.min(a.c, b.c),
  bottom: Math.max(a.r, b.r),
  right: Math.max(a.c, b.c),
});

const isInRange = (range: Range, { r, c }: Point) =>
  r >= range.top && r <= range.bottom && c >= range.left && c <= range.right;

const pointsIn = (range: Range) => {
  const points: Point[] = [];
  for (let r = range.top; r <= range.bottom; r++) {
    for (let c = range.left; c <= range.right; c++) {
      points.push({ r, c });
    }
  }
  return points;
};

/** a range grown to cover the merges it touches */
const coverMerges = (range: Range, merges: Range[]) => {
  let covered = range;
  for (let grew = true; grew; ) {
    grew = false;
    for (const merge of merges) {
      const touches =
        merge.top <= covered.bottom &&
        merge.bottom >= covered.top &&
        merge.left <= covered.right &&
        merge.right >= covered.left;
      const next = {
        top: Math.min(merge.top, covered.top),
        left: Math.min(merge.left, covered.left),
        bottom: Math.max(merge.bottom, covered.bottom),
        right: Math.max(merge.right, covered.right),
      };
      if (touches && JSON.stringify(next) !== JSON.stringify(covered)) {
        covered = next;
        grew = true;
      }
    }
  }
  return covered;
};

export const insertSheet = (api: ExcalidrawImperativeAPI) => {
  const { scrollX, scrollY, zoom, width, height } = api.getAppState();
  const sheet: SheetData = {
    rows: 50,
    cols: 26,
    cells: {},
    colWidths: {},
    rowHeights: {},
    merges: [],
  };
  // fits a phone's screen
  const sheetWidth = Math.min(WIDTH, width / zoom.value - 32);
  const element = newEmbeddableElement({
    type: "embeddable",
    x: width / 2 / zoom.value - scrollX - sheetWidth / 2,
    y: height / 2 / zoom.value - scrollY - HEIGHT / 2,
    width: sheetWidth,
    height: HEIGHT,
    strokeColor: "#e0e0e0",
    backgroundColor: "#ffffff",
    fillStyle: "solid",
    strokeWidth: 1,
    roughness: ROUGHNESS.architect,
    roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 8 },
    customData: { sheet },
  });
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), element],
    appState: { selectedElementIds: { [element.id]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
};

/** what was typed or pasted, with `[alias](url)` as a link's text and target */
const parseCell = (raw: string): Cell => {
  const { text, marks } = parseMarkdownLinks(raw, []);
  return marks.length === 1 && marks[0].end - marks[0].start === text.length
    ? { value: text, link: marks[0].href }
    : { value: raw };
};

/** a typed target as a safe link: "example.com" gets https, `javascript:` none */
const toHref = (target: string) => {
  const trimmed = target.trim();
  if (!trimmed) {
    return undefined;
  }
  const link = normalizeLink(
    /^[a-z][\w+.-]*:\/\/|^mailto:/i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`,
  );
  return link === "about:blank" ? undefined : link;
};

const LinkMenu = ({
  text,
  link,
  showText,
  onApply,
}: {
  text: string;
  link: string;
  showText: boolean;
  onApply: (text: string, target: string) => void;
}) => {
  const [label, setLabel] = useState(text);
  const [target, setTarget] = useState(link);
  return (
    <form
      className="sheet__menu sheet__link"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(label, target);
      }}
      // typing here is not for the grid; Escape closes through it
      onKeyDown={(event) => event.key !== "Escape" && event.stopPropagation()}
      onCopy={(event) => event.stopPropagation()}
      onCut={(event) => event.stopPropagation()}
      onPaste={(event) => event.stopPropagation()}
    >
      {showText && (
        <label>
          Text
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
      )}
      <label>
        Link
        <input
          autoFocus
          placeholder="https://"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        />
      </label>
      <div>
        <button type="submit" className="sheet__tool">
          Apply
        </button>
        {link && (
          <>
            <a
              className="sheet__tool"
              href={link}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open
            </a>
            <button
              type="button"
              className="sheet__tool"
              onClick={() => onApply(label, "")}
            >
              Remove
            </button>
          </>
        )}
      </div>
    </form>
  );
};

export const Sheet = memo(
  ({
    element,
    isActive,
    isDark,
  }: {
    element: ExcalidrawEmbeddableElement;
    isActive: boolean;
    isDark: boolean;
  }) => {
    const api = useExcalidrawAPI();
    const data: SheetData = element.customData?.sheet;
    const rootRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const isDragging = useRef(false);
    const skipReveal = useRef(false);
    const [anchor, setAnchor] = useState<Point>({ r: 0, c: 0 });
    const [focus, setFocus] = useState<Point>({ r: 0, c: 0 });
    const [draft, setDraft] = useState<{
      value: string;
      inCell: boolean;
    } | null>(null);
    const [menu, setMenu] = useState<"color" | "background" | "link" | null>(
      null,
    );
    const [resizing, setResizing] = useState<{
      axis: "col" | "row";
      index: number;
      size: number;
    } | null>(null);

    const ratesVersion = useSyncExternalStore(
      subscribeToRates,
      getRatesVersion,
    );
    const evaluate = useMemo(
      () => createEvaluator((id) => data.cells[id]?.value),
      // new rates recompute the cells that read them
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [data.cells, ratesVersion],
    );

    const selection = coverMerges(toRange(anchor, focus), data.merges);
    const anchorId = cellId(anchor);
    const anchorCell = data.cells[anchorId];
    const anchorStyle = anchorCell?.style ?? {};
    const anchorMerge = data.merges.find((merge) => isInRange(merge, anchor));
    const isSingleCell = anchor.r === focus.r && anchor.c === focus.c;

    const update = (patch: Partial<SheetData>) => {
      api?.updateScene({
        elements: api.getSceneElementsIncludingDeleted().map((el) =>
          el.id === element.id
            ? newElementWith(el, {
                customData: {
                  ...el.customData,
                  sheet: { ...el.customData?.sheet, ...patch },
                },
              })
            : el,
        ),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    };

    const patchCells = (points: Point[], patch: (cell: Cell) => Cell) => {
      const cells = { ...data.cells };
      for (const point of points) {
        const id = cellId(point);
        const next = patch(cells[id] ?? {});
        if (next.value || next.link || next.style) {
          cells[id] = next;
        } else {
          delete cells[id];
        }
      }
      update({ cells });
    };

    const applyStyle = (patch: CellStyle) =>
      patchCells(pointsIn(selection), (cell) => {
        const style = Object.fromEntries(
          Object.entries({ ...cell.style, ...patch }).filter(
            ([, value]) => value !== undefined,
          ),
        );
        return {
          ...cell,
          style: Object.keys(style).length ? style : undefined,
        };
      });

    const select = (point: Point, extend = false) => {
      if (!extend) {
        const merge = data.merges.find((merge) => isInRange(merge, point));
        const start = merge ? { r: merge.top, c: merge.left } : point;
        setAnchor(start);
        setFocus(start);
      } else {
        setFocus(point);
      }
    };

    /** whole rows, columns or the sheet, which may be longer than the view */
    const selectSpan = (start: Point, end: Point) => {
      skipReveal.current = true;
      select(start);
      setFocus(end);
      setMenu(null);
    };

    /** one step from a cell, across the whole of a merge */
    const step = (from: Point, dr: number, dc: number) => {
      const merge = data.merges.find((merge) => isInRange(merge, from));
      const r = dr > 0 ? (merge?.bottom ?? from.r) + dr : from.r + dr;
      const c = dc > 0 ? (merge?.right ?? from.c) + dc : from.c + dc;
      return {
        r: Math.max(0, Math.min(data.rows - 1, r)),
        c: Math.max(0, Math.min(data.cols - 1, c)),
      };
    };

    const finishEditing = () => {
      if (draft && draft.value !== (anchorCell?.value ?? "")) {
        const parsed = parseCell(draft.value);
        patchCells([anchor], (cell) => ({
          ...cell,
          ...parsed,
          link: parsed.value ? parsed.link ?? cell.link : undefined,
        }));
      }
      setDraft(null);
    };

    const clearValues = () =>
      patchCells(pointsIn(selection), (cell) => ({
        ...cell,
        value: undefined,
        link: undefined,
      }));

    const closeMenu = () => {
      setMenu(null);
      gridRef.current?.focus({ preventScroll: true });
    };

    const applyLink = (text: string, target: string) => {
      const link = toHref(target);
      if (isSingleCell) {
        const isFormula = anchorCell?.value?.startsWith("=");
        patchCells([anchor], (cell) => ({
          ...cell,
          link,
          value: isFormula ? cell.value : text || target || undefined,
        }));
      } else {
        patchCells(pointsIn(selection), (cell) =>
          cell.value ? { ...cell, link } : cell,
        );
      }
      closeMenu();
    };

    const toggleMerge = () => {
      if (anchorMerge) {
        update({ merges: data.merges.filter((m) => m !== anchorMerge) });
        return;
      }
      // only the top left cell's value survives, as in Google Sheets
      const cells = { ...data.cells };
      for (const point of pointsIn(selection).slice(1)) {
        delete cells[cellId(point)];
      }
      update({ cells, merges: [...data.merges, selection] });
      setAnchor({ r: selection.top, c: selection.left });
      setFocus({ r: selection.top, c: selection.left });
    };

    const selectionText = () => {
      const rows: string[] = [];
      for (let r = selection.top; r <= selection.bottom; r++) {
        const row: string[] = [];
        for (let c = selection.left; c <= selection.right; c++) {
          const id = cellId({ r, c });
          const cell = data.cells[id];
          const text = formatValue(evaluate(id), cell?.style?.format);
          row.push(cell?.link ? `[${text}](${cell.link})` : text);
        }
        rows.push(row.join("\t"));
      }
      return rows.join("\n");
    };

    const paste = (text: string) => {
      const rows = text
        .replace(/\r?\n$/, "")
        .split(/\r?\n/)
        .map((row) => row.split("\t"));
      const cells = { ...data.cells };
      rows.forEach((row, dr) =>
        row.forEach((value, dc) => {
          const id = cellId({ r: anchor.r + dr, c: anchor.c + dc });
          cells[id] = { ...cells[id], ...parseCell(value) };
        }),
      );
      const width = Math.max(...rows.map((row) => row.length));
      update({
        cells,
        rows: Math.max(data.rows, anchor.r + rows.length),
        cols: Math.max(data.cols, anchor.c + width),
      });
      setFocus({ r: anchor.r + rows.length - 1, c: anchor.c + width - 1 });
    };

    const onKeyDown = (event: React.KeyboardEvent) => {
      const isModified = event.metaKey || event.ctrlKey;
      if (event.key === "Escape" && menu) {
        event.stopPropagation();
        closeMenu();
        return;
      }
      // undo stays the canvas's, and Escape leaves the sheet for it
      if (
        (isModified && /^[zy]$/i.test(event.key)) ||
        (event.key === "Escape" && !draft)
      ) {
        return;
      }
      event.stopPropagation();

      if (draft) {
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          finishEditing();
          select(
            event.key === "Enter"
              ? step(anchor, event.shiftKey ? -1 : 1, 0)
              : step(anchor, 0, event.shiftKey ? -1 : 1),
          );
        } else if (event.key === "Escape") {
          setDraft(null);
        }
        return;
      }

      const arrow = ARROWS[event.key];
      if (arrow) {
        event.preventDefault();
        select(
          step(event.shiftKey ? focus : anchor, arrow[0], arrow[1]),
          event.shiftKey,
        );
      } else if (event.key === "Tab") {
        event.preventDefault();
        select(step(anchor, 0, event.shiftKey ? -1 : 1));
      } else if (event.key === "Enter" || event.key === "F2") {
        event.preventDefault();
        setDraft({ value: anchorCell?.value ?? "", inCell: true });
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        clearValues();
      } else if (isModified) {
        const pressed = event.key.toLowerCase();
        const key = SHORTCUTS[pressed];
        if (key) {
          event.preventDefault();
          applyStyle({ [key]: anchorStyle[key] ? undefined : true });
        } else if (pressed === "k") {
          event.preventDefault();
          setMenu("link");
        } else if (pressed === "a") {
          event.preventDefault();
          selectSpan({ r: 0, c: 0 }, { r: data.rows - 1, c: data.cols - 1 });
        }
      } else if (event.key.length === 1) {
        event.preventDefault();
        setDraft({ value: event.key, inCell: true });
      }
    };

    const startResize = (
      event: React.PointerEvent,
      axis: "col" | "row",
      index: number,
      size: number,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const zoom = api?.getAppState().zoom.value ?? 1;
      const start = axis === "col" ? event.clientX : event.clientY;
      let next = size;
      const onMove = (move: PointerEvent) => {
        const position = axis === "col" ? move.clientX : move.clientY;
        next = Math.max(MIN_SIZE, size + (position - start) / zoom);
        setResizing({ axis, index, size: next });
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setResizing(null);
        update(
          axis === "col"
            ? { colWidths: { ...data.colWidths, [index]: next } }
            : { rowHeights: { ...data.rowHeights, [index]: next } },
        );
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };

    const pointOf = (event: React.PointerEvent) => {
      const cell = (event.target as Element).closest<HTMLElement>("td");
      return cell && { r: Number(cell.dataset.r), c: Number(cell.dataset.c) };
    };

    useEffect(() => {
      const stopDragging = () => {
        isDragging.current = false;
      };
      window.addEventListener("pointerup", stopDragging);
      return () => window.removeEventListener("pointerup", stopDragging);
    }, []);

    const isEditing = draft !== null;
    useEffect(() => {
      if (isActive && !isEditing) {
        gridRef.current?.focus({ preventScroll: true });
      }
      if (!isActive) {
        setMenu(null);
      }
    }, [isActive, isEditing]);

    // keeps the moving end of the selection in sight, by hand since
    // `scrollIntoView` would also scroll the canvas's containers
    useLayoutEffect(() => {
      if (skipReveal.current) {
        skipReveal.current = false;
        return;
      }
      const grid = gridRef.current;
      const cell = grid?.querySelector<HTMLElement>(
        `td[data-r="${focus.r}"][data-c="${focus.c}"]`,
      );
      if (!grid || !cell) {
        return;
      }
      const right = cell.offsetLeft + cell.offsetWidth;
      const bottom = cell.offsetTop + cell.offsetHeight;
      if (cell.offsetLeft - HEADER_WIDTH < grid.scrollLeft) {
        grid.scrollLeft = cell.offsetLeft - HEADER_WIDTH;
      } else if (right > grid.scrollLeft + grid.clientWidth) {
        grid.scrollLeft = right - grid.clientWidth;
      }
      if (cell.offsetTop - HEADER_HEIGHT < grid.scrollTop) {
        grid.scrollTop = cell.offsetTop - HEADER_HEIGHT;
      } else if (bottom > grid.scrollTop + grid.clientHeight) {
        grid.scrollTop = bottom - grid.clientHeight;
      }
    }, [focus]);

    const widthOf = (c: number) =>
      resizing?.axis === "col" && resizing.index === c
        ? resizing.size
        : data.colWidths[c] ?? COLUMN_WIDTH;
    const heightOf = (r: number) =>
      resizing?.axis === "row" && resizing.index === r
        ? resizing.size
        : data.rowHeights[r] ?? ROW_HEIGHT;

    const columns = Array.from({ length: data.cols }, (_, c) => c);
    const paint = (color?: string) =>
      color && applyDarkModeFilter(color, isDark);
    const format = anchorStyle.format;

    return (
      <div
        ref={rootRef}
        className={clsx("sheet", { "sheet--active": isActive })}
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          if (!rootRef.current?.contains(event.relatedTarget)) {
            finishEditing();
          }
        }}
        onCopy={(event) => {
          event.stopPropagation();
          if (!draft) {
            event.preventDefault();
            event.clipboardData.setData("text/plain", selectionText());
          }
        }}
        onCut={(event) => {
          event.stopPropagation();
          if (!draft) {
            event.preventDefault();
            event.clipboardData.setData("text/plain", selectionText());
            clearValues();
          }
        }}
        onPaste={(event) => {
          event.stopPropagation();
          if (!draft) {
            event.preventDefault();
            paste(event.clipboardData.getData("text/plain"));
          }
        }}
      >
        <div
          className="sheet__toolbar"
          // the keyboard stays on the grid, or in the cell being edited
          onMouseDown={(event) => {
            if (!(event.target instanceof HTMLSelectElement)) {
              event.preventDefault();
            }
          }}
        >
          {FONT_STYLES.map(({ key, icon, title }) => (
            <button
              key={key}
              type="button"
              title={title}
              className={clsx("sheet__tool", { active: anchorStyle[key] })}
              onClick={() =>
                applyStyle({ [key]: anchorStyle[key] ? undefined : true })
              }
            >
              {icon}
            </button>
          ))}
          {COLOR_TOOLS.map(({ key, icon, title }) => (
            <button
              key={key}
              type="button"
              title={title}
              className={clsx("sheet__tool", { active: menu === key })}
              style={{
                boxShadow:
                  anchorStyle[key] &&
                  `inset 0 -3px 0 ${paint(anchorStyle[key])}`,
              }}
              onClick={() => setMenu(menu === key ? null : key)}
            >
              {icon}
            </button>
          ))}
          <button
            type="button"
            title="Link"
            className={clsx("sheet__tool", {
              active: menu === "link" || anchorCell?.link,
            })}
            onClick={() => setMenu(menu === "link" ? null : "link")}
          >
            {LinkIcon}
          </button>
          <span className="sheet__separator" />
          {ALIGNMENTS.map(({ align, icon, title }) => (
            <button
              key={align}
              type="button"
              title={title}
              className={clsx("sheet__tool", {
                active: anchorStyle.align === align,
              })}
              onClick={() =>
                applyStyle({
                  align: anchorStyle.align === align ? undefined : align,
                })
              }
            >
              {icon}
            </button>
          ))}
          <button
            type="button"
            className={clsx("sheet__tool", { active: anchorMerge })}
            disabled={
              !anchorMerge &&
              selection.top === selection.bottom &&
              selection.left === selection.right
            }
            onClick={toggleMerge}
          >
            Merge
          </button>
          <span className="sheet__separator" />
          <select
            title="Number format"
            value={format?.type ?? ""}
            onChange={(event) => {
              const type = event.target.value as NumberFormat["type"] | "";
              applyStyle({
                format: type ? { ...format, type } : undefined,
              });
              gridRef.current?.focus({ preventScroll: true });
            }}
          >
            <option value="">Automatic</option>
            <option value="number">Number</option>
            <option value="currency">Currency</option>
            <option value="financial">Financial</option>
          </select>
          {format?.type === "currency" && (
            <select
              title="Currency"
              value={format.currency ?? "USD"}
              onChange={(event) => {
                applyStyle({
                  format: { ...format, currency: event.target.value },
                });
                gridRef.current?.focus({ preventScroll: true });
              }}
            >
              {CURRENCIES.map((currency) => (
                <option key={currency}>{currency}</option>
              ))}
            </select>
          )}
          {[
            { label: ".0", title: "Fewer decimals", change: -1 },
            { label: ".00", title: "More decimals", change: 1 },
          ].map(({ label, title, change }) => (
            <button
              key={label}
              type="button"
              title={title}
              className="sheet__tool"
              onClick={() =>
                applyStyle({
                  format: {
                    type: "number",
                    ...format,
                    decimals: Math.max(
                      0,
                      Math.min(MAX_DECIMALS, (format?.decimals ?? 2) + change),
                    ),
                  },
                })
              }
            >
              {label}
            </button>
          ))}
          <span className="sheet__separator" />
          <button
            type="button"
            className="sheet__tool"
            title="Clear formatting"
            onClick={() =>
              patchCells(pointsIn(selection), ({ value, link }) => ({
                value,
                link,
              }))
            }
          >
            Clear
          </button>
        </div>

        {isActive && (menu === "color" || menu === "background") && (
          <div
            className="sheet__menu"
            onMouseDown={(event) => event.preventDefault()}
          >
            <div className="sheet__palette-top">
              <button
                type="button"
                className="sheet__tool"
                onClick={() => {
                  applyStyle({ [menu]: undefined });
                  setMenu(null);
                }}
              >
                {COLOR_TOOLS.find(({ key }) => key === menu)?.none}
              </button>
              {[
                COLOR_PALETTE.black,
                COLOR_PALETTE.white,
                ...SHADES.flatMap((shade) =>
                  HUES.map((hue) => COLOR_PALETTE[hue][shade]),
                ),
              ].map((color) => (
                <button
                  key={color}
                  type="button"
                  title={color}
                  className={clsx("sheet__swatch", {
                    active: anchorStyle[menu] === color,
                  })}
                  style={{ background: paint(color) }}
                  onClick={() => {
                    applyStyle({ [menu]: color });
                    setMenu(null);
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {isActive && menu === "link" && (
          <LinkMenu
            key={anchorId}
            text={anchorCell?.value ?? ""}
            link={anchorCell?.link ?? ""}
            showText={isSingleCell && !anchorCell?.value?.startsWith("=")}
            onApply={applyLink}
          />
        )}

        <div className="sheet__formula">
          <span>{anchorId}</span>
          <input
            aria-label="Formula"
            value={draft ? draft.value : anchorCell?.value ?? ""}
            onFocus={() =>
              !draft &&
              setDraft({ value: anchorCell?.value ?? "", inCell: false })
            }
            onChange={(event) =>
              setDraft({
                value: event.target.value,
                inCell: draft?.inCell ?? false,
              })
            }
          />
        </div>

        <div ref={gridRef} className="sheet__grid" tabIndex={0}>
          <table
            style={{
              width: columns.reduce((sum, c) => sum + widthOf(c), HEADER_WIDTH),
            }}
          >
            <colgroup>
              <col style={{ width: HEADER_WIDTH }} />
              {columns.map((c) => (
                <col key={c} style={{ width: widthOf(c) }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th
                  title="Select all"
                  onPointerDown={() => {
                    finishEditing();
                    selectSpan(
                      { r: 0, c: 0 },
                      { r: data.rows - 1, c: data.cols - 1 },
                    );
                  }}
                />
                {columns.map((c) => (
                  <th
                    key={c}
                    className={clsx({
                      selected: c >= selection.left && c <= selection.right,
                    })}
                    onPointerDown={(event) => {
                      finishEditing();
                      selectSpan(
                        { r: 0, c: event.shiftKey ? anchor.c : c },
                        { r: data.rows - 1, c },
                      );
                    }}
                  >
                    {columnName(c)}
                    <span
                      className="sheet__resize sheet__resize--col"
                      onPointerDown={(event) =>
                        startResize(event, "col", c, widthOf(c))
                      }
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody
              onPointerDown={(event) => {
                const point = pointOf(event);
                if (!point || (event.target as Element).tagName === "INPUT") {
                  return;
                }
                finishEditing();
                setMenu(null);
                select(point, event.shiftKey);
                isDragging.current = event.pointerType === "mouse";
              }}
              onPointerOver={(event) => {
                const point = pointOf(event);
                if (isDragging.current && point) {
                  select(point, true);
                }
              }}
              onDoubleClick={() =>
                setDraft({ value: anchorCell?.value ?? "", inCell: true })
              }
            >
              {Array.from({ length: data.rows }, (_, r) => (
                <tr key={r} style={{ height: heightOf(r) }}>
                  <th
                    className={clsx({
                      selected: r >= selection.top && r <= selection.bottom,
                    })}
                    onPointerDown={(event) => {
                      finishEditing();
                      selectSpan(
                        { r: event.shiftKey ? anchor.r : r, c: 0 },
                        { r, c: data.cols - 1 },
                      );
                    }}
                  >
                    {r + 1}
                    <span
                      className="sheet__resize sheet__resize--row"
                      onPointerDown={(event) =>
                        startResize(event, "row", r, heightOf(r))
                      }
                    />
                  </th>
                  {columns.map((c) => {
                    const point = { r, c };
                    const merge = data.merges.find((merge) =>
                      isInRange(merge, point),
                    );
                    if (merge && (merge.top !== r || merge.left !== c)) {
                      return null;
                    }
                    const id = cellId(point);
                    const cell = data.cells[id];
                    const style = cell?.style;
                    const value = cell?.value ? evaluate(id) : null;
                    const isAnchor = anchor.r === r && anchor.c === c;
                    const text = formatValue(value, style?.format);
                    const href =
                      cell?.link ??
                      (cell?.value && BARE_URL.test(cell.value)
                        ? cell.value
                        : undefined);
                    return (
                      <td
                        key={c}
                        data-r={r}
                        data-c={c}
                        rowSpan={merge && merge.bottom - merge.top + 1}
                        colSpan={merge && merge.right - merge.left + 1}
                        className={clsx({
                          selected: isInRange(selection, point),
                          anchor: isAnchor,
                        })}
                        style={
                          style || typeof value === "number"
                            ? {
                                fontWeight: style?.bold ? 700 : undefined,
                                fontStyle: style?.italic ? "italic" : undefined,
                                textDecoration:
                                  clsx(
                                    style?.underline && "underline",
                                    style?.strike && "line-through",
                                  ) || undefined,
                                color: paint(style?.color),
                                background: paint(style?.background),
                                textAlign:
                                  style?.align ??
                                  (typeof value === "number"
                                    ? "right"
                                    : undefined),
                              }
                            : undefined
                        }
                      >
                        {isAnchor && draft?.inCell ? (
                          <input
                            className="sheet__editor"
                            autoFocus
                            size={Math.max(1, draft.value.length + 1)}
                            value={draft.value}
                            onChange={(event) =>
                              setDraft({
                                value: event.target.value,
                                inCell: true,
                              })
                            }
                          />
                        ) : href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            draggable={false}
                            style={{ color: paint(style?.color ?? LINK_COLOR) }}
                            // a click selects the cell, Cmd/Ctrl+click opens
                            onClick={(event) => {
                              if (!event.metaKey && !event.ctrlKey) {
                                event.preventDefault();
                              }
                            }}
                          >
                            {text}
                          </a>
                        ) : (
                          text
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  },
);
