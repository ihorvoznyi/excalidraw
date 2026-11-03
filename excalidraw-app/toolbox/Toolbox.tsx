import { useExcalidrawAPI } from "@excalidraw/excalidraw";
import { createIcon } from "@excalidraw/excalidraw/components/icons";

import { insertCode } from "./code";
import { insertTodo } from "./todo";

import "./Toolbox.scss";

const tablerIconProps = {
  width: 24,
  height: 24,
  fill: "none",
  strokeWidth: 2,
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export const toolboxIcon = createIcon(
  <path d="M7 10h3v-3l-3.5 -3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1 -3 3l-6 -6a6 6 0 0 1 -8 -8l3.5 3.5" />,
  tablerIconProps,
);

const todoIcon = createIcon(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 12l2 2l4 -4" />
  </>,
  tablerIconProps,
);

const codeIcon = createIcon(
  <>
    <path d="M7 8l-4 4l4 4" />
    <path d="M17 8l4 4l-4 4" />
    <path d="M14 4l-4 16" />
  </>,
  tablerIconProps,
);

export const Toolbox = () => {
  const excalidrawAPI = useExcalidrawAPI();

  return (
    <div className="toolbox">
      <button
        type="button"
        className="toolbox__item"
        onClick={() => excalidrawAPI && insertTodo(excalidrawAPI)}
      >
        {todoIcon}
        To-do
      </button>
      <button
        type="button"
        className="toolbox__item"
        onClick={() => excalidrawAPI && insertCode(excalidrawAPI)}
      >
        {codeIcon}
        Code block
      </button>
    </div>
  );
};
