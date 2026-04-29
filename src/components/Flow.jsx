"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Panel,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import NodeSkillPanel from "./NodeSkillPanel";
import EdgeConditionPanel from "./EdgeConditionPanel";

function AddNodePanel({ onCreateAt }) {
  const { screenToFlowPosition } = useReactFlow();

  const handleClick = (e) => {
    e.stopPropagation();
    const pane = document.querySelector(".react-flow");
    if (!pane) return;
    const r = pane.getBoundingClientRect();
    const position = screenToFlowPosition({
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
    });
    onCreateAt(position);
  };

  return (
    <Panel position="bottom-left" className="graph-add-node-panel">
      <button type="button" className="graph-add-node-btn" onClick={handleClick}>
        + Add node
      </button>
    </Panel>
  );
}

function HistoryPanel({ canUndo, canRedo, busy, onUndo, onRedo, onClear }) {
  return (
    <Panel position="top-left" className="graph-history-panel">
      <button
        type="button"
        className="graph-history-btn"
        onClick={onUndo}
        disabled={!canUndo || busy}
        title="Undo (Ctrl/Cmd+Z)"
      >
        Undo
      </button>
      <button
        type="button"
        className="graph-history-btn"
        onClick={onRedo}
        disabled={!canRedo || busy}
        title="Redo (Ctrl/Cmd+Shift+Z or Ctrl+Y)"
      >
        Redo
      </button>
      <button
        type="button"
        className="graph-history-btn graph-history-btn-clear"
        onClick={onClear}
        disabled={busy || (!canUndo && !canRedo)}
        title="Clear undo/redo history"
        aria-label="Clear undo/redo history"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M19 6l-1 14H6L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
        </svg>
      </button>
    </Panel>
  );
}

export default function Flow() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [historyState, setHistoryState] = useState({
    canUndo: false,
    canRedo: false,
  });
  const [historyBusy, setHistoryBusy] = useState(false);

  const refreshHistoryState = useCallback(async () => {
    const res = await fetch("/api/graph/history");
    if (!res.ok) return;
    const state = await res.json();
    setHistoryState({
      canUndo: Boolean(state.canUndo),
      canRedo: Boolean(state.canRedo),
    });
  }, []);

  const loadGraph = useCallback(async () => {
    const [graphRes, historyRes] = await Promise.all([
      fetch("/api/graph"),
      fetch("/api/graph/history"),
    ]);
    if (graphRes.ok) {
      const data = await graphRes.json();
      setNodes(data.nodes || []);
      setEdges(data.edges || []);
    }
    if (historyRes.ok) {
      const state = await historyRes.json();
      setHistoryState({
        canUndo: Boolean(state.canUndo),
        canRedo: Boolean(state.canRedo),
      });
    }
  }, [setEdges, setNodes]);

  useEffect(() => {
    loadGraph().finally(() => setLoading(false));
  }, [loadGraph]);

  const onConnect = useCallback(
    async (connection) => {
      const newEdge = {
        ...connection,
        id: `${connection.source}-${connection.target}`,
        markerEnd: { type: "arrowclosed" },
        data: { executorType: "default" },
      };

      setEdges((prev) => addEdge(newEdge, prev));

      await fetch("/api/edges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_node: connection.source,
          to_node: connection.target,
          type: "default",
          data: {},
        }),
      });
      await refreshHistoryState();
    },
    [refreshHistoryState, setEdges]
  );

  const onNodesDelete = useCallback(
    async (deletedNodes) => {
      for (const node of deletedNodes) {
        const res = await fetch("/api/nodes", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: node.id }),
        });

        if (res.ok) {
          const { deleted } = await res.json();
          setNodes((prev) => prev.filter((n) => !deleted.includes(n.id)));
          setEdges((prev) =>
            prev.filter(
              (e) => !deleted.includes(e.source) && !deleted.includes(e.target)
            )
          );
          await refreshHistoryState();
        }
      }
    },
    [refreshHistoryState, setNodes, setEdges]
  );

  const onEdgesDelete = useCallback(
    async (deletedEdges) => {
      for (const edge of deletedEdges) {
        await fetch("/api/edges", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            from_node: edge.source,
            to_node: edge.target,
          }),
        });
      }
      await refreshHistoryState();
    },
    [refreshHistoryState]
  );

  const createNodeAtPosition = useCallback(
    async (position) => {
      const id = prompt("Node ID (e.g. my_node):");
      if (!id) return;

      const label = prompt("Display label:", id) || id;

      const res = await fetch("/api/nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, label, position }),
      });

      if (res.ok) {
        const node = await res.json();
        setNodes((prev) => [...prev, node]);
        await refreshHistoryState();
      }
    },
    [refreshHistoryState, setNodes]
  );

  const onNodeClick = useCallback((event, node) => {
    setSelectedEdge(null);
    setSelectedNode({ id: node.id, label: node.data?.label || node.id });
  }, []);

  const onEdgeClick = useCallback((event, edge) => {
    setSelectedNode(null);
    setSelectedEdge(edge);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
  }, []);

  const handleEdgeSaved = useCallback(
    async (updated) => {
      setEdges((eds) =>
        eds.map((e) =>
          e.id === updated.id
            ? {
                ...e,
                label: updated.label,
                data: updated.data,
              }
            : e
        )
      );
      await refreshHistoryState();
    },
    [refreshHistoryState, setEdges]
  );

  const persistNodePositions = useCallback(async (toSave) => {
    await Promise.all(
      toSave.map((n) =>
        fetch("/api/nodes", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: n.id,
            position: { x: n.position.x, y: n.position.y },
          }),
        })
      )
    );
    await refreshHistoryState();
  }, [refreshHistoryState]);

  const performUndo = useCallback(async () => {
    if (!historyState.canUndo || historyBusy) return;
    setHistoryBusy(true);
    try {
      const res = await fetch("/api/graph/undo", { method: "POST" });
      if (!res.ok) return;
      await loadGraph();
      setSelectedNode(null);
      setSelectedEdge(null);
    } finally {
      setHistoryBusy(false);
    }
  }, [historyBusy, historyState.canUndo, loadGraph]);

  const performRedo = useCallback(async () => {
    if (!historyState.canRedo || historyBusy) return;
    setHistoryBusy(true);
    try {
      const res = await fetch("/api/graph/redo", { method: "POST" });
      if (!res.ok) return;
      await loadGraph();
      setSelectedNode(null);
      setSelectedEdge(null);
    } finally {
      setHistoryBusy(false);
    }
  }, [historyBusy, historyState.canRedo, loadGraph]);

  const performClearHistory = useCallback(async () => {
    if (historyBusy || (!historyState.canUndo && !historyState.canRedo)) return;
    const ok = window.confirm(
      "Clear undo/redo history? This cannot be undone."
    );
    if (!ok) return;

    setHistoryBusy(true);
    try {
      const res = await fetch("/api/graph/history/clear", { method: "POST" });
      if (!res.ok) return;
      await refreshHistoryState();
    } finally {
      setHistoryBusy(false);
    }
  }, [historyBusy, historyState.canRedo, historyState.canUndo, refreshHistoryState]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      const tagName = target?.tagName?.toLowerCase();
      const inEditable =
        tagName === "input" ||
        tagName === "textarea" ||
        target?.isContentEditable;
      if (inEditable) return;

      const isMeta = event.metaKey || event.ctrlKey;
      if (!isMeta) return;

      const key = event.key.toLowerCase();
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        void performRedo();
      } else if (key === "z") {
        event.preventDefault();
        void performUndo();
      } else if (key === "y") {
        event.preventDefault();
        void performRedo();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [performRedo, performUndo]);

  const onNodeDragStop = useCallback(
    (_event, _node, draggedNodes) => {
      if (draggedNodes?.length) void persistNodePositions(draggedNodes);
    },
    [persistNodePositions]
  );

  const onSelectionDragStop = useCallback(
    (_event, draggedNodes) => {
      if (draggedNodes?.length) void persistNodePositions(draggedNodes);
    },
    [persistNodePositions]
  );

  if (loading) {
    return <div style={{ padding: "2rem" }}>Loading graph...</div>;
  }

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onNodeDragStop={onNodeDragStop}
        onSelectionDragStop={onSelectionDragStop}
        fitView
      >
        <Background />
        <Controls />
        <HistoryPanel
          canUndo={historyState.canUndo}
          canRedo={historyState.canRedo}
          busy={historyBusy}
          onUndo={performUndo}
          onRedo={performRedo}
          onClear={performClearHistory}
        />
        <AddNodePanel onCreateAt={createNodeAtPosition} />
      </ReactFlow>

      {selectedNode && (
        <NodeSkillPanel
          nodeId={selectedNode.id}
          nodeLabel={selectedNode.label}
          onClose={() => setSelectedNode(null)}
          onMutated={refreshHistoryState}
        />
      )}

      {selectedEdge && (
        <EdgeConditionPanel
          edge={selectedEdge}
          onClose={() => setSelectedEdge(null)}
          onSaved={handleEdgeSaved}
        />
      )}
    </div>
  );
}
