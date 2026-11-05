import { useExcalidrawAPI } from "@excalidraw/excalidraw";
import DropdownMenu from "@excalidraw/excalidraw/components/dropdownMenu/DropdownMenu";
import { createIcon } from "@excalidraw/excalidraw/components/icons";
import { useTunnels } from "@excalidraw/excalidraw/context/tunnels";

import { insertCode } from "./code";
import { insertSheet } from "./Sheet";
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

const sheetIcon = createIcon(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18" />
    <path d="M3 15h18" />
    <path d="M10 4v16" />
  </>,
  tablerIconProps,
);

const ITEMS = [
  { label: "To-do", icon: todoIcon, insert: insertTodo },
  { label: "Code block", icon: codeIcon, insert: insertCode },
  { label: "Sheet", icon: sheetIcon, insert: insertSheet },
];

export const Toolbox = () => {
  const excalidrawAPI = useExcalidrawAPI();

  return (
    <div className="toolbox">
      {ITEMS.map(({ label, icon, insert }) => (
        <button
          key={label}
          type="button"
          className="toolbox__item"
          onClick={() => excalidrawAPI && insert(excalidrawAPI)}
        >
          {icon}
          {label}
        </button>
      ))}
    </div>
  );
};

/** the same items, on hover in the toolbar's "more tools" menu */
export const ToolboxMenu = () => {
  const excalidrawAPI = useExcalidrawAPI();
  const { ExtraToolsTunnel } = useTunnels();

  return (
    <ExtraToolsTunnel.In>
      <DropdownMenu.Sub>
        <DropdownMenu.Sub.Trigger icon={toolboxIcon}>
          Components
        </DropdownMenu.Sub.Trigger>
        <DropdownMenu.Sub.Content>
          {ITEMS.map(({ label, icon, insert }) => (
            <DropdownMenu.Item
              key={label}
              icon={icon}
              onSelect={() => excalidrawAPI && insert(excalidrawAPI)}
            >
              {label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Sub.Content>
      </DropdownMenu.Sub>
    </ExtraToolsTunnel.In>
  );
};
