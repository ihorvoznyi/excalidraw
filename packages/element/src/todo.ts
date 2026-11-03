import {
  BOUND_TEXT_PADDING,
  DEFAULT_FONT_SIZE,
  getFontString,
} from "@excalidraw/common";
import { pointFrom, pointRotateRads } from "@excalidraw/math";

import type { Radians } from "@excalidraw/math";

import { getLineHeightInPx, getLineWidth } from "./textMeasurements";

import type { RenderEnvironment } from "./renderEnvironment";
import type { ExcalidrawElement, ExcalidrawTextElement } from "./types";

/**
 * A to-do item: a rectangle tagged with `customData.todo`, drawn as a
 * checkbox left of its label (bound text) instead of an outline.
 */
export const isTodoElement = (element: ExcalidrawElement | null) =>
  element?.type === "rectangle" &&
  typeof element.customData?.todo?.checked === "boolean";

/** room left of a to-do's label for its checkbox */
export const getTodoInset = (
  container: ExcalidrawElement,
  label: ExcalidrawTextElement | null,
) =>
  isTodoElement(container) ? (label?.fontSize ?? DEFAULT_FONT_SIZE) * 1.5 : 0;

/**
 * The checkbox (a font-size square centered on the label's first line) and
 * the label's lines, in the container's unrotated local coords.
 */
export const getTodoLayout = (
  container: ExcalidrawElement,
  label: ExcalidrawTextElement | null,
  renderEnvironment?: RenderEnvironment,
) => {
  const size = label?.fontSize ?? DEFAULT_FONT_SIZE;
  if (!label) {
    return {
      box: { x: BOUND_TEXT_PADDING, y: (container.height - size) / 2, size },
      lines: [],
    };
  }
  const lineHeight = getLineHeightInPx(label.fontSize, label.lineHeight);
  // a to-do's label rotates with it about the container's center
  const [centerX, centerY] = pointRotateRads(
    pointFrom(label.x + label.width / 2, label.y + label.height / 2),
    pointFrom(
      container.x + container.width / 2,
      container.y + container.height / 2,
    ),
    -container.angle as Radians,
  );
  const left = centerX - label.width / 2 - container.x;
  const top = centerY - label.height / 2 - container.y;
  const font = getFontString(label);

  return {
    box: { x: BOUND_TEXT_PADDING, y: top + (lineHeight - size) / 2, size },
    lines: label.text.split("\n").map((line, index) => {
      const width = getLineWidth(line, font, renderEnvironment);
      return {
        x:
          left +
          (label.textAlign === "center"
            ? (label.width - width) / 2
            : label.textAlign === "right"
            ? label.width - width
            : 0),
        y: top + (index + 0.5) * lineHeight,
        width,
      };
    }),
  };
};
