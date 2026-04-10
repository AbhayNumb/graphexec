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

export default function Flow() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);

  useEffect(() => {
    fetch("/api/graph")
      .then((res) => res.json())
      .then((data) => {
        setNodes(data.nodes);
        setEdges(data.edges);
      })
      .finally(() => setLoading(false));
  }, []);

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
    },
    [setEdges]
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
        }
      }
    },
    [setNodes, setEdges]
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
    },
    []
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
      }
    },
    [setNodes]
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
    (updated) => {
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
    },
    [setEdges]
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
  }, []);

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
        <AddNodePanel onCreateAt={createNodeAtPosition} />
      </ReactFlow>

      {selectedNode && (
        <NodeSkillPanel
          nodeId={selectedNode.id}
          nodeLabel={selectedNode.label}
          onClose={() => setSelectedNode(null)}
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
