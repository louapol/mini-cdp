# mini-cdp
Building my own customer data platform

**Goal**: Ingest events + traits, unify into profiles, build 1 - 2 simple audiences, and export/activate them

**Endpoints**:

- POST /identify → upsert profile traits (email, user_id, etc.)
- POST /track → record events (event_type, properties)
- GET /audiences/:id/export → CSV of members

**Data Model**:

- profiles (id, email, user_id, first_seen_at, last_seen_at, total_orders, total_spend, traits JSONB)
- events (id, profile_id?, anonymous_id, user_id, event_type, properties JSONB, occurred_at)
- audiences (id, name, definition JSON, last_built_at)
- audience_members (audience_id, profile_id, added_at)

**Identity rules (simple, deterministic):**

- If user_id or email exists → attach/update that profile
- otherwise → create placeholder profile (or keep as anonymous)
