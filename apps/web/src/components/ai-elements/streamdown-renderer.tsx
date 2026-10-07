"use client";

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import type { ComponentProps } from "react";
import { Streamdown } from "streamdown";

const streamdownPlugins = { cjk, code, math, mermaid };

export type StreamdownRendererProps = ComponentProps<typeof Streamdown>;

export const StreamdownRenderer = (props: StreamdownRendererProps) => (
  <Streamdown plugins={streamdownPlugins} {...props} />
);
