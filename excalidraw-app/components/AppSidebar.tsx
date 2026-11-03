import { DefaultSidebar, Sidebar } from "@excalidraw/excalidraw";
import { LoadIcon } from "@excalidraw/excalidraw/components/icons";
import { useUIAppState } from "@excalidraw/excalidraw/context/ui-appState";

import { ClaudeChat, claudeIcon } from "../claude/ClaudeChat";
import { Toolbox, toolboxIcon } from "../toolbox/Toolbox";

import { Canvases } from "./Canvases";

import "./AppSidebar.scss";

export const AppSidebar = () => {
  const { openSidebar } = useUIAppState();

  return (
    <DefaultSidebar>
      <DefaultSidebar.TabTriggers>
        <Sidebar.TabTrigger
          tab="canvases"
          title="Canvases"
          style={{ opacity: openSidebar?.tab === "canvases" ? 1 : 0.4 }}
        >
          {LoadIcon}
        </Sidebar.TabTrigger>
        <Sidebar.TabTrigger
          tab="toolbox"
          title="Toolbox"
          style={{ opacity: openSidebar?.tab === "toolbox" ? 1 : 0.4 }}
        >
          {toolboxIcon}
        </Sidebar.TabTrigger>
        <Sidebar.TabTrigger
          tab="claude"
          title="Claude"
          style={{ opacity: openSidebar?.tab === "claude" ? 1 : 0.4 }}
        >
          {claudeIcon}
        </Sidebar.TabTrigger>
      </DefaultSidebar.TabTriggers>
      <Sidebar.Tab tab="canvases">
        <Canvases />
      </Sidebar.Tab>
      <Sidebar.Tab tab="toolbox">
        <Toolbox />
      </Sidebar.Tab>
      <Sidebar.Tab tab="claude">
        <ClaudeChat />
      </Sidebar.Tab>
    </DefaultSidebar>
  );
};
