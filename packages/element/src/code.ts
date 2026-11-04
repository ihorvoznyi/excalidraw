import { FONT_FAMILY } from "@excalidraw/common";
import { refractor } from "refractor/core";
import markdown from "refractor/markdown";
import rust from "refractor/rust";
import sql from "refractor/sql";
import typescript from "refractor/typescript";

import type { RootContent } from "hast";

import type { TextStyle } from "./textRuns";
import type { ExcalidrawElement, ExcalidrawTextElement } from "./types";

// typescript registers javascript too
refractor.register(markdown);
refractor.register(rust);
refractor.register(sql);
refractor.register(typescript);

/** a code block's languages (as refractor names them) and display names */
export const CODE_LANGUAGES: Record<string, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  rust: "Rust",
  sql: "SQL",
  markdown: "Markdown",
};

/** room around a code block's label, twice that above it for its language */
export const CODE_PADDING = 16;

/** a code block's label, however it comes to be */
export const CODE_LABEL = {
  fontSize: 16,
  fontFamily: FONT_FAMILY.Cascadia,
  strokeColor: "#1e1e1e",
  textAlign: "left",
  verticalAlign: "top",
} as const;

// light theme colors, which the dark theme gets through its color filter
const TOKEN_COLORS: Record<string, string> = {
  comment: "#668578",
  blockquote: "#668578",
  keyword: "#297349",
  title: "#297349",
  builtin: "#067855",
  "class-name": "#067855",
  macro: "#067855",
  string: "#94492c",
  char: "#94492c",
  regex: "#94492c",
  code: "#94492c",
  number: "#2c61a1",
  boolean: "#2c61a1",
  constant: "#2c61a1",
  url: "#2c61a1",
  operator: "#de5c62",
  list: "#de5c62",
};

/**
 * A code block: a rectangle tagged with `customData.code`, its label
 * highlighted as `customData.code.language`.
 */
export const isCodeElement = (element: ExcalidrawElement | null) =>
  element?.type === "rectangle" &&
  typeof element.customData?.code?.language === "string";

/** a code block's padding across an axis, both sides together */
export const getCodePadding = (container: ExcalidrawElement, axis: "x" | "y") =>
  isCodeElement(container) ? CODE_PADDING * (axis === "x" ? 2 : 3) : undefined;

/**
 * A code block's label highlighted: a style per UTF-16 unit of its
 * `originalText`, or null for other text.
 */
export const getCodeStyles = (
  label: ExcalidrawTextElement,
  container: ExcalidrawElement | null,
) => {
  if (!container || !isCodeElement(container)) {
    return null;
  }
  const styles: TextStyle[] = [];
  const walk = (nodes: RootContent[], style: TextStyle) => {
    for (const node of nodes) {
      if (node.type === "text") {
        for (let i = 0; i < node.value.length; i++) {
          styles.push(style);
        }
      } else if (node.type === "element") {
        const names = node.properties.className as string[];
        const token = names.find((name) => TOKEN_COLORS[name]);
        walk(node.children, {
          color: token ? TOKEN_COLORS[token] : style.color,
          italic:
            style.italic ||
            names.includes("comment") ||
            names.includes("italic"),
          bold: style.bold || names.includes("bold") || names.includes("title"),
        });
      }
    }
  };
  walk(
    refractor.highlight(label.originalText, container.customData?.code.language)
      .children,
    {},
  );
  return styles;
};
