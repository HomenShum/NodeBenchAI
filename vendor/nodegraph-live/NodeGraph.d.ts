import { type AssertionReceipt, type GraphEdge, type GraphNode } from "./graph-model.js";
export type NodeClickMessage = {
    source: "nodegraph";
    kind: "node";
    id: string;
    label: string;
    nodeKind: string;
    /** Absent means no measurement; zero is a real measured value. */
    count?: number;
    edges: {
        other: string;
        weight: number;
        type: string;
        receipt?: AssertionReceipt;
    }[];
};
export type ContextMessage = {
    source: "nodegraph";
    intent: "context";
    kind: "node";
    label: string;
    nodeKind: string;
};
export type NodeGraphProps = {
    nodes: GraphNode[];
    edges: GraphEdge[];
    /** Interaction frequency per node id. Text only. Never a visual channel. */
    visits?: Record<string, number>;
    dark?: boolean;
    height?: number;
    /** Override the ring hue per node kind. */
    kindColors?: Record<string, {
        light: string;
        dark: string;
    }>;
    onNode?: (m: NodeClickMessage) => void;
    onContext?: (m: ContextMessage) => void;
};
export declare function NodeGraph({ nodes, edges, visits, dark, height, kindColors, onNode, onContext, }: NodeGraphProps): import("react").JSX.Element;
export default NodeGraph;
//# sourceMappingURL=NodeGraph.d.ts.map