import { arrayToMap, viewportCoordsToSceneCoords } from "@excalidraw/common";

import type {
  ElementsMap,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

const HIT_PADDING = 4;

type Box = { x: number; y: number; width: number; height: number };

/**
 * Makes a box drawn on elements (in their local coords, null where there is
 * none) a button: presses on it never reach the editor, so they don't
 * select, drag or (on double click/tap) edit, even when locked.
 */
export const registerCanvasButton = (
  api: ExcalidrawImperativeAPI,
  getBox: (
    element: NonDeletedExcalidrawElement,
    elementsMap: ElementsMap,
  ) => Box | null,
  onPress: (element: NonDeletedExcalidrawElement) => void,
) => {
  const buttonAt = (
    target: EventTarget | null,
    point: { clientX: number; clientY: number },
  ) => {
    const appState = api.getAppState();
    // lasso is the default selection tool on phones
    if (
      (appState.activeTool.type !== "selection" &&
        appState.activeTool.type !== "lasso") ||
      !(target instanceof HTMLCanvasElement) ||
      !target.classList.contains("interactive")
    ) {
      return undefined;
    }
    const { x, y } = viewportCoordsToSceneCoords(point, appState);
    const elements = api.getSceneElements();
    const elementsMap = arrayToMap(elements);
    return elements.find((el) => {
      const box = getBox(el, elementsMap);
      return (
        box &&
        x >= el.x + box.x - HIT_PADDING &&
        x <= el.x + box.x + box.width + HIT_PADDING &&
        y >= el.y + box.y - HIT_PADDING &&
        y <= el.y + box.y + box.height + HIT_PADDING
      );
    });
  };

  const onPointerDown = (event: MouseEvent | TouchEvent) => {
    const point = "touches" in event ? event.touches[0] : event;
    const element =
      (!("button" in event) || event.button === 0) &&
      buttonAt(event.target, point);
    if (element) {
      event.stopPropagation();
      if (event.type === "pointerdown") {
        onPress(element);
      }
    }
  };

  // runs after the editor's own pointermove, which sets its cursor
  let hovering = false;
  const onPointerMove = (event: PointerEvent) => {
    const hover = !!buttonAt(event.target, event);
    if (hover) {
      api.setCursor("pointer");
    } else if (hovering) {
      api.resetCursor();
    }
    hovering = hover;
  };

  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("touchstart", onPointerDown, true);
  window.addEventListener("dblclick", onPointerDown, true);
  window.addEventListener("pointermove", onPointerMove);

  return () => {
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("touchstart", onPointerDown, true);
    window.removeEventListener("dblclick", onPointerDown, true);
    window.removeEventListener("pointermove", onPointerMove);
  };
};
