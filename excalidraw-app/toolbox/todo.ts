import { ROUGHNESS } from "@excalidraw/common";
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  getBoundTextElement,
  getTodoLayout,
  isTextElement,
  isTodoElement,
  newElementWith,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { registerCanvasButton } from "./canvasButton";

const SNIPPET = /^:todo(\s+|$)/;
const MIN_WIDTH = 200;

// ?v=2 previews the cartoonist sloppiness instead of artist
const roughness =
  new URLSearchParams(window.location.search).get("v") === "2"
    ? ROUGHNESS.cartoonist
    : ROUGHNESS.artist;

// one element (a rectangle tagged as a to-do) with its text as the label
const newTodo = (
  x: number,
  y: number,
  width: number,
  { text, fontSize, fontFamily, strokeColor }: Partial<ExcalidrawTextElement>,
) =>
  convertToExcalidrawElements([
    {
      type: "rectangle",
      x,
      y,
      width,
      roughness,
      strokeColor,
      customData: { todo: { checked: false } },
      label: {
        text: text || "To do",
        fontSize,
        fontFamily,
        strokeColor,
        textAlign: "left",
        verticalAlign: "middle",
      },
    },
  ]);

export const insertTodo = (api: ExcalidrawImperativeAPI) => {
  const { scrollX, scrollY, zoom, width, height } = api.getAppState();
  const [todo, label] = newTodo(
    width / 2 / zoom.value - scrollX - MIN_WIDTH / 2,
    height / 2 / zoom.value - scrollY,
    MIN_WIDTH,
    {},
  );
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), todo, label],
    appState: { selectedElementIds: { [todo.id]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
};

const toggleTodo = (api: ExcalidrawImperativeAPI, todo: ExcalidrawElement) => {
  api.updateScene({
    elements: api.getSceneElementsIncludingDeleted().map((el) =>
      el === todo
        ? newElementWith(el, {
            customData: {
              ...el.customData,
              todo: { checked: !el.customData?.todo.checked },
            },
          })
        : el,
    ),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
};

export const registerTodo = (api: ExcalidrawImperativeAPI) => {
  const offCheckbox = registerCanvasButton(
    api,
    (el, elementsMap) => {
      if (!isTodoElement(el)) {
        return null;
      }
      const { box } = getTodoLayout(el, getBoundTextElement(el, elementsMap));
      return { x: box.x, y: box.y, width: box.size, height: box.size };
    },
    (todo) => toggleTodo(api, todo),
  );

  // ":todo <text>" becomes a to-do once its text edit is committed
  let editingId: string | null = null;
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
          !el.containerId &&
          SNIPPET.test(el.text),
      );
    if (snippet) {
      api.updateScene({
        elements: [
          ...elements.map((el) =>
            el === snippet ? newElementWith(el, { isDeleted: true }) : el,
          ),
          ...newTodo(
            snippet.x,
            snippet.y,
            Math.max(MIN_WIDTH, snippet.width + snippet.fontSize * 2),
            { ...snippet, text: snippet.text.replace(SNIPPET, "") },
          ),
        ],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    }
  });

  return () => {
    offCheckbox();
    offChange();
  };
};
