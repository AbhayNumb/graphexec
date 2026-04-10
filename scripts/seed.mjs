import pg from "pg";

const pool = new pg.Pool({
  connectionString: "postgresql://IAMAI:AKeEs2wT5hIy@65.20.76.38:5432/IAMAI",
});

async function seed() {
  const client = await pool.connect();
  try {
    // Drop old UUID-based tables and recreate with TEXT-based schema
    await client.query("BEGIN");

    await client.query("DROP TABLE IF EXISTS node_skill_variables CASCADE");
    await client.query("DROP TABLE IF EXISTS node_skills CASCADE");
    await client.query("DROP TABLE IF EXISTS skills CASCADE");
    await client.query("DROP TABLE IF EXISTS variables CASCADE");
    await client.query("DROP TABLE IF EXISTS edges CASCADE");
    await client.query("DROP TABLE IF EXISTS nodes CASCADE");
    await client.query("DROP TABLE IF EXISTS graphs CASCADE");

    await client.query(`
      CREATE TABLE graphs (
        id TEXT PRIMARY KEY,
        name TEXT,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE nodes (
        id TEXT NOT NULL,
        graph_id TEXT NOT NULL,
        label TEXT,
        type TEXT,
        data JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (graph_id, id),
        CONSTRAINT fk_nodes_graph FOREIGN KEY (graph_id) REFERENCES graphs(id) ON DELETE CASCADE
      )
    `);

    await client.query(`
      CREATE TABLE edges (
        id BIGSERIAL PRIMARY KEY,
        graph_id TEXT NOT NULL,
        from_node TEXT NOT NULL,
        to_node TEXT NOT NULL,
        label TEXT,
        type TEXT,
        data JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_edges_from_node FOREIGN KEY (graph_id, from_node) REFERENCES nodes(graph_id, id) ON DELETE CASCADE,
        CONSTRAINT fk_edges_to_node FOREIGN KEY (graph_id, to_node) REFERENCES nodes(graph_id, id) ON DELETE CASCADE,
        CONSTRAINT unique_edge UNIQUE (graph_id, from_node, to_node, type)
      )
    `);

    await client.query("CREATE INDEX idx_nodes_graph_id ON nodes (graph_id)");
    await client.query("CREATE INDEX idx_edges_graph_id ON edges (graph_id)");
    await client.query("CREATE INDEX idx_edges_from_node ON edges (from_node)");
    await client.query("CREATE INDEX idx_edges_to_node ON edges (to_node)");
    await client.query("CREATE INDEX idx_nodes_type ON nodes (type)");
    await client.query("CREATE INDEX idx_edges_type ON edges (type)");
    await client.query("CREATE INDEX idx_nodes_data_gin ON nodes USING GIN (data)");
    await client.query("CREATE INDEX idx_edges_data_gin ON edges USING GIN (data)");

    await client.query(`
      CREATE TABLE variables (
        id BIGSERIAL,
        graph_id TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('secret', 'normal')),
        data_type TEXT NOT NULL CHECK (data_type IN ('TEXT', 'BOOLEAN', 'JSON')),
        default_value TEXT,
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (graph_id, name),
        CONSTRAINT fk_variables_graph FOREIGN KEY (graph_id) REFERENCES graphs(id) ON DELETE CASCADE,
        CONSTRAINT chk_secret_prefix CHECK (
          (kind = 'secret' AND name LIKE 'SECRET_%') OR (kind = 'normal' AND name NOT LIKE 'SECRET_%')
        )
      )
    `);

    await client.query("CREATE INDEX idx_variables_graph_id ON variables (graph_id)");
    await client.query("CREATE INDEX idx_variables_kind ON variables (kind)");

    await client.query(`
      CREATE TABLE skills (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('db_query', 'api_call', 'llm_call', 'python_fn', 'transform')),
        config JSONB NOT NULL DEFAULT '{}',
        code TEXT,
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query("CREATE INDEX idx_skills_type ON skills (type)");

    await client.query(`
      CREATE TABLE node_skills (
        id BIGSERIAL PRIMARY KEY,
        graph_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        execution_order INT NOT NULL,
        config_override JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        FOREIGN KEY (graph_id, node_id) REFERENCES nodes(graph_id, id) ON DELETE CASCADE,
        UNIQUE (graph_id, node_id, execution_order)
      )
    `);
    await client.query("CREATE INDEX idx_node_skills_lookup ON node_skills (graph_id, node_id, execution_order)");
    await client.query("CREATE INDEX idx_node_skills_skill ON node_skills (skill_id)");

    await client.query(`
      CREATE TABLE node_skill_variables (
        id BIGSERIAL PRIMARY KEY,
        node_skill_id BIGINT NOT NULL REFERENCES node_skills(id) ON DELETE CASCADE,
        graph_id TEXT NOT NULL,
        variable_name TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('input', 'output')),
        UNIQUE (node_skill_id, variable_name, direction),
        FOREIGN KEY (graph_id, variable_name) REFERENCES variables(graph_id, name) ON DELETE CASCADE
      )
    `);
    await client.query("CREATE INDEX idx_nsv_node_skill ON node_skill_variables (node_skill_id)");
    await client.query("CREATE INDEX idx_nsv_variable ON node_skill_variables (graph_id, variable_name)");

    // Create graph
    await client.query(
      "INSERT INTO graphs (id, name) VALUES ($1, $2)",
      ["main", "Main Graph"]
    );

    // Create nodes: Context_initializer --> init_booking_data --> triage
    await client.query(
      `INSERT INTO nodes (graph_id, id, label, type, data) VALUES
        ('main', 'context_initializer', 'Context Initializer', 'default', '{"position": {"x": 0, "y": 100}}'),
        ('main', 'init_booking_data',   'Init Booking Data',   'default', '{"position": {"x": 300, "y": 100}}'),
        ('main', 'triage',              'Triage',              'default', '{"position": {"x": 600, "y": 100}}')`
    );

    // Create edges
    await client.query(
      `INSERT INTO edges (graph_id, from_node, to_node, type) VALUES
        ('main', 'context_initializer', 'init_booking_data', 'default'),
        ('main', 'init_booking_data',   'triage',            'default')`
    );

    await client.query("COMMIT");
    console.log("Done. Graph ID: main");
    console.log("Nodes: context_initializer --> init_booking_data --> triage");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
