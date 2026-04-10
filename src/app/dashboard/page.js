"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function DashboardHome() {
  const [stats, setStats] = useState({ nodes: 0, edges: 0 });

  useEffect(() => {
    fetch("/api/graph")
      .then((res) => res.json())
      .then((data) => {
        setStats({
          nodes: data.nodes?.length ?? 0,
          edges: data.edges?.length ?? 0,
        });
      })
      .catch(() => {});
  }, []);

  return (
    <div className="dashboard-home">
      <h1>Dashboard</h1>
      <p className="subtitle">Overview of your graph workspace</p>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Nodes</div>
          <div className="stat-value">{stats.nodes}</div>
          <div className="stat-hint">Across all graphs</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Edges</div>
          <div className="stat-value">{stats.edges}</div>
          <div className="stat-hint">Connections between nodes</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Graphs</div>
          <div className="stat-value">1</div>
          <div className="stat-hint">Active graph</div>
        </div>
      </div>

      <div className="quick-actions">
        <h2>Quick Actions</h2>
        <div className="actions-row">
          <Link href="/dashboard/graph" className="action-card">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="5" cy="6" r="2" />
              <circle cx="19" cy="6" r="2" />
              <circle cx="12" cy="18" r="2" />
              <line x1="5" y1="8" x2="12" y2="16" />
              <line x1="19" y1="8" x2="12" y2="16" />
            </svg>
            Open Graph Editor
          </Link>
        </div>
      </div>
    </div>
  );
}
