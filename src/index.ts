import express from "express";
import type { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ---- Postgres pool ----
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// ---- Helpers ----

function isNonEmptyString(v: any): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function quoteCsvValue(value: any): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  // Escape quotes by doubling them, wrap in quotes if contains comma or quote
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ---- Routes ----

// Basic root route for convenience
app.get("/", (_req: Request, res: Response) => {
  res.json({
    message: "Mini CDP API is running",
    docs: [
      { path: "/health", description: "Check API and database connectivity" },
      { path: "/identify", description: "POST to upsert a customer profile" },
      { path: "/track", description: "POST to track an event" },
      { path: "/audiences", description: "POST to create audiences" },
      { path: "/audiences/:id/rebuild", description: "POST to rebuild audience membership" },
      { path: "/audiences/:id/export", description: "GET to export audience members as CSV" },
      { path: "/profiles", description: "GET to list profiles" },
    ],
  });
});

// Health check
app.get("/health", async (_req: Request, res: Response) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch (err) {
    console.error("Health check failed:", err);
    res.status(500).json({ status: "error" });
  }
});

/**
 * POST /identify
 * Upsert a profile based on email / user_id / anonymous_id
 */
app.post("/identify", async (req: Request, res: Response) => {
  const { email, user_id, anonymous_id, traits } = req.body || {};

  if (!isNonEmptyString(email) && !isNonEmptyString(user_id) && !isNonEmptyString(anonymous_id)) {
    return res.status(400).json({
      error: "At least one of email, user_id, or anonymous_id is required",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let profile: any | null = null;

    // Try lookup by user_id, then email, then anonymous_id
    if (isNonEmptyString(user_id)) {
      const result = await client.query(
        "SELECT * FROM profiles WHERE user_id = $1",
        [user_id]
      );
      if (result.rowCount > 0) profile = result.rows[0];
    }

    if (!profile && isNonEmptyString(email)) {
      const result = await client.query(
        "SELECT * FROM profiles WHERE email = $1",
        [email]
      );
      if (result.rowCount > 0) profile = result.rows[0];
    }

    if (!profile && isNonEmptyString(anonymous_id)) {
      const result = await client.query(
        "SELECT * FROM profiles WHERE anonymous_id = $1",
        [anonymous_id]
      );
      if (result.rowCount > 0) profile = result.rows[0];
    }

    const primaryIdentifier =
      (isNonEmptyString(user_id) && user_id) ||
      (isNonEmptyString(email) && email) ||
      (isNonEmptyString(anonymous_id) && anonymous_id) ||
      null;

    if (!profile) {
      // Create new profile
      const traitsObj = traits && typeof traits === "object" ? traits : {};
      const insert = await client.query(
        `
        INSERT INTO profiles (
          primary_identifier,
          email,
          user_id,
          anonymous_id,
          traits,
          first_seen_at,
          last_seen_at
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW())
        RETURNING *;
      `,
        [
          primaryIdentifier,
          isNonEmptyString(email) ? email : null,
          isNonEmptyString(user_id) ? user_id : null,
          isNonEmptyString(anonymous_id) ? anonymous_id : null,
          JSON.stringify(traitsObj),
        ]
      );
      profile = insert.rows[0];
    } else {
      // Update existing profile
      const mergedTraits = {
        ...(profile.traits || {}),
        ...(traits && typeof traits === "object" ? traits : {}),
      };

      const update = await client.query(
        `
        UPDATE profiles
        SET
          email = COALESCE($1, email),
          user_id = COALESCE($2, user_id),
          anonymous_id = COALESCE($3, anonymous_id),
          traits = $4::jsonb,
          last_seen_at = NOW(),
          primary_identifier = COALESCE(primary_identifier, $5)
        WHERE id = $6
        RETURNING *;
      `,
        [
          isNonEmptyString(email) ? email : null,
          isNonEmptyString(user_id) ? user_id : null,
          isNonEmptyString(anonymous_id) ? anonymous_id : null,
          JSON.stringify(mergedTraits),
          primaryIdentifier,
          profile.id,
        ]
      );
      profile = update.rows[0];
    }

    await client.query("COMMIT");
    res.json({ profile });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error in /identify:", err);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

/**
 * POST /track
 * Track an event and attach it to a profile if possible.
 */
app.post("/track", async (req: Request, res: Response) => {
  const {
    event_type,
    email,
    user_id,
    anonymous_id,
    properties,
    occurred_at,
  } = req.body || {};

  if (!isNonEmptyString(event_type)) {
    return res.status(400).json({ error: "event_type is required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let profile: any | null = null;

    // Try find profile using identifiers
    if (isNonEmptyString(user_id)) {
      const r = await client.query("SELECT * FROM profiles WHERE user_id = $1", [user_id]);
      if (r.rowCount > 0) profile = r.rows[0];
    }

    if (!profile && isNonEmptyString(email)) {
      const r = await client.query("SELECT * FROM profiles WHERE email = $1", [email]);
      if (r.rowCount > 0) profile = r.rows[0];
    }

    if (!profile && isNonEmptyString(anonymous_id)) {
      const r = await client.query(
        "SELECT * FROM profiles WHERE anonymous_id = $1",
        [anonymous_id]
      );
      if (r.rowCount > 0) profile = r.rows[0];
    }

    // If still no profile but we have at least one identifier, create a minimal one
    if (!profile && (isNonEmptyString(user_id) || isNonEmptyString(email) || isNonEmptyString(anonymous_id))) {
      const primaryIdentifier =
        (isNonEmptyString(user_id) && user_id) ||
        (isNonEmptyString(email) && email) ||
        (isNonEmptyString(anonymous_id) && anonymous_id) ||
        null;

      const insert = await client.query(
        `
        INSERT INTO profiles (
          primary_identifier,
          email,
          user_id,
          anonymous_id,
          traits,
          first_seen_at,
          last_seen_at
        )
        VALUES ($1, $2, $3, $4, '{}'::jsonb, NOW(), NOW())
        RETURNING *;
      `,
        [
          primaryIdentifier,
          isNonEmptyString(email) ? email : null,
          isNonEmptyString(user_id) ? user_id : null,
          isNonEmptyString(anonymous_id) ? anonymous_id : null,
        ]
      );
      profile = insert.rows[0];
    }

    const occurredAt = occurred_at ? new Date(occurred_at) : new Date();
    const props = properties && typeof properties === "object" ? properties : {};

    const eventInsert = await client.query(
      `
      INSERT INTO events (
        profile_id,
        user_id,
        anonymous_id,
        event_type,
        properties,
        occurred_at
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      RETURNING *;
    `,
      [
        profile ? profile.id : null,
        isNonEmptyString(user_id) ? user_id : null,
        isNonEmptyString(anonymous_id) ? anonymous_id : null,
        event_type,
        JSON.stringify(props),
        occurredAt,
      ]
    );

    const event = eventInsert.rows[0];

    // Update profile aggregates if we have a profile
    let updatedProfile = profile;

    if (profile) {
      if (event_type.toLowerCase() === "purchase") {
        const amount = Number(props.amount || 0);
        if (!isNaN(amount) && amount > 0) {
          const upd = await client.query(
            `
            UPDATE profiles
            SET
              total_orders = total_orders + 1,
              total_spend = total_spend + $1,
              last_seen_at = GREATEST(last_seen_at, $2)
            WHERE id = $3
            RETURNING *;
          `,
            [amount, occurredAt, profile.id]
          );
          updatedProfile = upd.rows[0];
        } else {
          const upd = await client.query(
            `
            UPDATE profiles
            SET last_seen_at = GREATEST(last_seen_at, $1)
            WHERE id = $2
            RETURNING *;
          `,
            [occurredAt, profile.id]
          );
          updatedProfile = upd.rows[0];
        }
      } else {
        const upd = await client.query(
          `
          UPDATE profiles
          SET last_seen_at = GREATEST(last_seen_at, $1)
          WHERE id = $2
          RETURNING *;
        `,
          [occurredAt, profile.id]
        );
        updatedProfile = upd.rows[0];
      }
    }

    await client.query("COMMIT");

    res.json({
      event,
      profile: updatedProfile,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error in /track:", err);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

/**
 * POST /audiences
 * Create an audience definition.
 */
app.post("/audiences", async (req: Request, res: Response) => {
  const { name, definition } = req.body || {};

  if (!isNonEmptyString(name)) {
    return res.status(400).json({ error: "name is required" });
  }

  if (!definition || typeof definition !== "object") {
    return res.status(400).json({ error: "definition (JSON) is required" });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO audiences (name, definition)
      VALUES ($1, $2::jsonb)
      RETURNING *;
    `,
      [name, JSON.stringify(definition)]
    );

    res.status(201).json({ audience: result.rows[0] });
  } catch (err) {
    console.error("Error in /audiences:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /audiences/:id/rebuild
 * Rebuild audience membership based on its definition.
 *
 * This example assumes a definition structure like:
 * {
 *   "min_total_spend": 100,
 *   "days_since_last_event": 30
 * }
 */
app.post("/audiences/:id/rebuild", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: "Invalid audience id" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      "SELECT definition FROM audiences WHERE id = $1",
      [id]
    );

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Audience not found" });
    }

    const definition = result.rows[0].definition || {};
    const minTotalSpend = Number(definition.min_total_spend || 0);
    const daysSinceLastEvent = Number(
      definition.days_since_last_event || 36500 // effectively "always"
    );

    // Delete existing members
    await client.query("DELETE FROM audience_members WHERE audience_id = $1", [
      id,
    ]);

    // Compute cutoff date for last event
    const cutoffDate = new Date(
      Date.now() - daysSinceLastEvent * 24 * 60 * 60 * 1000
    );

    const insertMembers = await client.query(
      `
      INSERT INTO audience_members (audience_id, profile_id, added_at)
      SELECT
        $1 AS audience_id,
        p.id AS profile_id,
        NOW() AS added_at
      FROM profiles p
      LEFT JOIN (
        SELECT profile_id, MAX(occurred_at) AS last_event_at
        FROM events
        GROUP BY profile_id
      ) e ON e.profile_id = p.id
      WHERE p.total_spend >= $2
        AND e.last_event_at IS NOT NULL
        AND e.last_event_at >= $3
      RETURNING *;
    `,
      [id, minTotalSpend, cutoffDate]
    );

    await client.query(
      "UPDATE audiences SET last_built_at = NOW() WHERE id = $1",
      [id]
    );

    await client.query("COMMIT");

    res.json({
      audience_id: id,
      added_members: insertMembers.rowCount,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error in /audiences/:id/rebuild:", err);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

// List audiences
app.get("/audiences", async (_req: Request, res: Response) => {
    try {
      const result = await pool.query(
        `
        SELECT id, name, definition, created_at, last_built_at
        FROM audiences
        ORDER BY created_at DESC
        `
      );
  
      res.json({ audiences: result.rows });
    } catch (err) {
      console.error("Error in GET /audiences:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
  

/**
 * GET /audiences/:id/export
 * Export audience members as CSV (email, user_id, total_spend, total_orders, last_seen_at)
 */
app.get("/audiences/:id/export", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: "Invalid audience id" });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        p.email,
        p.user_id,
        p.total_spend,
        p.total_orders,
        p.last_seen_at
      FROM audience_members am
      JOIN profiles p ON p.id = am.profile_id
      WHERE am.audience_id = $1
      ORDER BY p.last_seen_at DESC;
    `,
      [id]
    );

    const rows = result.rows;

    const header = [
      "email",
      "user_id",
      "total_spend",
      "total_orders",
      "last_seen_at",
    ];
    const lines: string[] = [];
    lines.push(header.join(","));

    for (const row of rows) {
      lines.push(
        [
          quoteCsvValue(row.email),
          quoteCsvValue(row.user_id),
          quoteCsvValue(row.total_spend),
          quoteCsvValue(row.total_orders),
          quoteCsvValue(
            row.last_seen_at ? new Date(row.last_seen_at).toISOString() : ""
          ),
        ].join(",")
      );
    }

    const csv = lines.join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="audience_${id}.csv"`
    );
    res.send(csv);
  } catch (err) {
    console.error("Error in /audiences/:id/export:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// List profiles (simple, with limit & offset)
app.get("/profiles", async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(String(req.query.limit || "50"), 10), 200);
    const offset = parseInt(String(req.query.offset || "0"), 10);
  
    try {
      const result = await pool.query(
        `
        SELECT id, email, user_id, anonymous_id, total_orders, total_spend, last_seen_at
        FROM profiles
        ORDER BY last_seen_at DESC
        LIMIT $1 OFFSET $2
        `,
        [limit, offset]
      );
  
      res.json({ profiles: result.rows });
    } catch (err) {
      console.error("Error in GET /profiles:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
  
  // Get a single profile + traits
  app.get("/profiles/:id", async (req: Request, res: Response) => {
    const id = req.params.id;
  
    try {
      const result = await pool.query(
        `
        SELECT id, email, user_id, anonymous_id, traits, total_orders, total_spend, first_seen_at, last_seen_at
        FROM profiles
        WHERE id = $1
        `,
        [id]
      );
  
      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Profile not found" });
      }
  
      res.json({ profile: result.rows[0] });
    } catch (err) {
      console.error("Error in GET /profiles/:id:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
  
  // Get events for a profile
  app.get("/profiles/:id/events", async (req: Request, res: Response) => {
    const id = req.params.id;
  
    try {
      const result = await pool.query(
        `
        SELECT id, event_type, properties, occurred_at
        FROM events
        WHERE profile_id = $1
        ORDER BY occurred_at DESC
        `,
        [id]
      );
  
      res.json({ events: result.rows });
    } catch (err) {
      console.error("Error in GET /profiles/:id/events:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

// ---- Start server ----

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Mini CDP API listening on http://localhost:${port}`);
});
