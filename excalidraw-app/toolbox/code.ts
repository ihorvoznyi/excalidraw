import {
  ROUGHNESS,
  ROUNDNESS,
  arrayToMap,
  viewportCoordsToSceneCoords,
} from "@excalidraw/common";
import {
  CODE_LABEL,
  CODE_LANGUAGES,
  CaptureUpdateAction,
  convertToExcalidrawElements,
  getContainerElement,
  getTextLinkAt,
  isTextElement,
  newElementWith,
} from "@excalidraw/element";
import { pointFrom, pointRotateRads } from "@excalidraw/math";

import type { Radians } from "@excalidraw/math";
import type { ExcalidrawTextElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

// "```sql", the code, then maybe a closing fence
const FENCE = /^```(\w+)[^\S\n]*\n([\s\S]+?)(?:\n```)?\s*$/;
const ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  rs: "rust",
  md: "markdown",
};
const LANGUAGES = Object.keys(CODE_LANGUAGES);
const MIN_WIDTH = 240;

// one element (a rectangle tagged as a code block) sized to its code, with
// room for its language dropdown beside short code
const newCodeBlock = (x: number, y: number, language: string, text: string) => {
  const [block, label] = convertToExcalidrawElements([
    {
      type: "rectangle",
      x,
      y,
      strokeColor: "#e0e0e0",
      backgroundColor: "#f5f5f5",
      fillStyle: "solid",
      strokeWidth: 1,
      roughness: ROUGHNESS.architect,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 8 },
      customData: { code: { language } },
      label: { text, ...CODE_LABEL },
    },
  ]);
  return [
    newElementWith(block, { width: Math.max(MIN_WIDTH, block.width) }),
    label,
  ];
};

export const insertCode = (api: ExcalidrawImperativeAPI) => {
  const { scrollX, scrollY, zoom, width, height } = api.getAppState();
  const [block, label] = newCodeBlock(
    width / 2 / zoom.value - scrollX - MIN_WIDTH / 2,
    height / 2 / zoom.value - scrollY,
    "typescript",
    "// code",
  );
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), block, label],
    appState: { selectedElementIds: { [block.id]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
};

export const registerCode = (api: ExcalidrawImperativeAPI) => {
  // a text starting with "```sql" becomes a code block once its edit is
  // committed
  let editingId: string | null = null;

  // Cmd/Ctrl+click on a markdown link's alias opens it
  const onPointerDown = (event: PointerEvent) => {
    if (
      !(event.metaKey || event.ctrlKey) ||
      !(event.target instanceof HTMLCanvasElement)
    ) {
      return;
    }
    const { x, y } = viewportCoordsToSceneCoords(event, api.getAppState());
    const elements = api.getSceneElements();
    const elementsMap = arrayToMap(elements);
    for (const label of elements) {
      const container = isTextElement(label)
        ? getContainerElement(label, elementsMap)
        : null;
      if (!isTextElement(label) || !container) {
        continue;
      }
      const [localX, localY] = pointRotateRads(
        pointFrom(x, y),
        pointFrom(
          container.x + container.width / 2,
          container.y + container.height / 2,
        ),
        -container.angle as Radians,
      );
      const href = getTextLinkAt(
        label,
        container,
        localX - label.x,
        localY - label.y,
      );
      if (href) {
        event.preventDefault();
        event.stopPropagation();
        window.open(href, "_blank", "noopener,noreferrer");
        return;
      }
    }
  };
  window.addEventListener("pointerdown", onPointerDown, true);
  const offChange = api.onChange((elements, appState) => {
    const committedId = editingId;
    editingId = appState.editingTextElement?.id ?? null;
    const snippet =
      committedId !== editingId &&
      elements.find(
        (el): el is ExcalidrawTextElement =>
          el.id === committedId &&
          !el.isDeleted &&
          isTextElement(el) &&
          !el.containerId,
      );
    const [, alias = "", code = ""] =
      (snippet && snippet.originalText.match(FENCE)) || [];
    const language = ALIASES[alias.toLowerCase()] ?? alias.toLowerCase();
    if (snippet && LANGUAGES.includes(language)) {
      api.updateScene({
        elements: [
          ...elements.map((el) =>
            el === snippet ? newElementWith(el, { isDeleted: true }) : el,
          ),
          ...newCodeBlock(snippet.x, snippet.y, language, code),
        ],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    }
  });
  return () => {
    offChange();
    window.removeEventListener("pointerdown", onPointerDown, true);
  };
};
