import clsx from "clsx";
import { useLayoutEffect, useRef, useState } from "react";

import { applyDarkModeFilter, THEME } from "@excalidraw/common";

import type { TextStyle } from "@excalidraw/element";
import type { Theme } from "@excalidraw/element/types";

import { atom, useAtomValue } from "../editor-jotai";
import { t } from "../i18n";

import { TopPicks } from "./ColorPicker/TopPicks";
import {
  BoldIcon,
  HighlightIcon,
  ItalicIcon,
  StrikethroughIcon,
  TextIcon,
  UnderlineIcon,
} from "./icons";

import "./TextStylePanel.scss";

export type TextStyleSelection = {
  /** the selection's start, in the editor container's coords */
  left: number;
  top: number;
  activeStyle: TextStyle;
  /** applies a style to the selection, or clears it (null) */
  apply: (patch: TextStyle | null) => void;
};

export const textStylePanelAtom = atom<TextStyleSelection | null>(null);

const STYLE_BUTTONS = [
  { key: "bold", icon: BoldIcon, label: "labels.bold" },
  { key: "italic", icon: ItalicIcon, label: "labels.italic" },
  { key: "underline", icon: UnderlineIcon, label: "labels.underline" },
  { key: "strike", icon: StrikethroughIcon, label: "labels.strikethrough" },
] as const;

const MARGIN = 8;

export const TextStylePanel = ({ theme }: { theme: Theme }) => {
  const selection = useAtomValue(textStylePanelAtom);
  const ref = useRef<HTMLDivElement>(null);
  const [openRow, setOpenRow] = useState<"color" | "background" | null>(null);
  // temporary: ?v=1 (default) swatch rows on demand, ?v=2 always visible
  const alwaysOpen = new URLSearchParams(location.search).get("v") === "2";

  useLayoutEffect(() => {
    const panel = ref.current;
    const parent = panel?.offsetParent;
    if (!panel || !parent || !selection) {
      return;
    }
    const maxLeft = parent.clientWidth - panel.offsetWidth - MARGIN;
    panel.style.left = `${Math.max(
      MARGIN,
      Math.min(selection.left - panel.offsetWidth / 2, maxLeft),
    )}px`;
    panel.style.top = `${Math.max(
      MARGIN,
      selection.top - panel.offsetHeight - MARGIN,
    )}px`;
  });

  if (!selection) {
    return null;
  }
  const { activeStyle, apply } = selection;
  const toggle = (key: keyof TextStyle, value: string | true | undefined) =>
    apply({ [key]: activeStyle[key] === value ? undefined : value });
  const swatches = (key: "color" | "background") => (
    <TopPicks
      theme={theme}
      type={key === "color" ? "elementStroke" : "elementBackground"}
      activeColor={activeStyle[key] ?? null}
      onChange={(color) =>
        toggle(key, color === "transparent" ? undefined : color)
      }
    />
  );
  const colorButtons = [
    { key: "color", icon: TextIcon, label: "labels.textColor" },
    { key: "background", icon: HighlightIcon, label: "labels.highlight" },
  ] as const;

  return (
    <div
      ref={ref}
      className="text-style-panel"
      onMouseDown={(event) => event.preventDefault()}
      onPointerDown={(event) => event.preventDefault()}
    >
      {(alwaysOpen || openRow === "color") && swatches("color")}
      {(alwaysOpen || openRow === "background") && swatches("background")}
      <div className="text-style-panel__row">
        {STYLE_BUTTONS.map(({ key, icon, label }) => (
          <button
            key={key}
            type="button"
            title={t(label)}
            className={clsx({ active: activeStyle[key] })}
            onClick={() => toggle(key, true)}
          >
            {icon}
          </button>
        ))}
        {!alwaysOpen &&
          colorButtons.map(({ key, icon, label }) => (
            <button
              key={key}
              type="button"
              title={t(label)}
              className={clsx({ active: openRow === key })}
              onClick={() => setOpenRow(openRow === key ? null : key)}
              style={{
                color:
                  activeStyle[key] &&
                  applyDarkModeFilter(activeStyle[key]!, theme === THEME.DARK),
              }}
            >
              {icon}
            </button>
          ))}
        <button type="button" onClick={() => apply(null)}>
          {t("buttons.clear")}
        </button>
      </div>
    </div>
  );
};
