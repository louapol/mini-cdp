import React, { useEffect, useState } from "react";

const API_BASE = "http://localhost:3000";

interface Profile {
  id: string;
  email: string | null;
  user_id: string | null;
  anonymous_id: string | null;
  total_orders: number;
  total_spend: string | number;
  last_seen_at: string;
}

interface EventRecord {
  id: string;
  event_type: string;
  properties: any;
  occurred_at: string;
}

interface Audience {
  id: number;
  name: string;
  definition: any;
  created_at: string;
  last_built_at: string | null;
}

const App: React.FC = () => {
  // Identify form state
  const [idEmail, setIdEmail] = useState("");
  const [idUserId, setIdUserId] = useState("");
  const [idAnon, setIdAnon] = useState("");
  const [idTraits, setIdTraits] = useState('{"plan": "gold"}');

  // Track form state
  const [eventType, setEventType] = useState("page_view");
  const [evUserId, setEvUserId] = useState("");
  const [evAnon, setEvAnon] = useState("");
  const [evAmount, setEvAmount] = useState("");
  const [evProps, setEvProps] = useState('{"page": "/home"}');

  // Profiles / selection
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [profileEvents, setProfileEvents] = useState<EventRecord[]>([]);

  // Audiences
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [audName, setAudName] = useState("High value last 30 days");
  const [audDef, setAudDef] = useState(
    JSON.stringify(
      {
        min_total_spend: 100,
        days_since_last_event: 30,
      },
      null,
      2
    )
  );

  // Messages
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Helpers
  function showMessage(msg: string) {
    setMessage(msg);
    setError(null);
  }

  function showError(msg: string) {
    setError(msg);
    setMessage(null);
  }

  async function fetchProfiles() {
    try {
      const res = await fetch(`${API_BASE}/profiles`);
      const data = await res.json();
      setProfiles(data.profiles || []);
    } catch (err) {
      console.error(err);
      showError("Failed to load profiles");
    }
  }

  async function fetchAudiences() {
    try {
      const res = await fetch(`${API_BASE}/audiences`);
      const data = await res.json();
      setAudiences(data.audiences || []);
    } catch (err) {
      console.error(err);
      showError("Failed to load audiences");
    }
  }

  useEffect(() => {
    fetchProfiles();
    fetchAudiences();
  }, []);

  async function handleIdentify(e: React.FormEvent) {
    e.preventDefault();
    try {
      let traitsObj: any = {};
      if (idTraits.trim()) {
        traitsObj = JSON.parse(idTraits);
      }

      const res = await fetch(`${API_BASE}/identify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: idEmail || undefined,
          user_id: idUserId || undefined,
          anonymous_id: idAnon || undefined,
          traits: traitsObj,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Identify failed");
      }

      const body = await res.json();
      showMessage("Profile created/updated");
      await fetchProfiles();
      if (body.profile) {
        setSelectedProfile(body.profile);
        await loadProfileEvents(body.profile.id);
      }
    } catch (err: any) {
      console.error(err);
      showError(err.message || "Error in identify");
    }
  }

  async function handleTrack(e: React.FormEvent) {
    e.preventDefault();
    try {
      let propsObj: any = {};
      if (evProps.trim()) {
        propsObj = JSON.parse(evProps);
      }

      // If amount set, merge into properties
      if (evAmount.trim()) {
        propsObj.amount = Number(evAmount);
      }

      const res = await fetch(`${API_BASE}/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_type: eventType,
          user_id: evUserId || undefined,
          anonymous_id: evAnon || undefined,
          properties: propsObj,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Track failed");
      }

      const body = await res.json();
      showMessage("Event tracked");
      await fetchProfiles();
      if (body.profile) {
        setSelectedProfile(body.profile);
        await loadProfileEvents(body.profile.id);
      }
    } catch (err: any) {
      console.error(err);
      showError(err.message || "Error in track");
    }
  }

  async function selectProfile(p: Profile) {
    setSelectedProfile(p);
    await loadProfileEvents(p.id);
  }

  async function loadProfileEvents(profileId: string) {
    try {
      const res = await fetch(`${API_BASE}/profiles/${profileId}/events`);
      const data = await res.json();
      setProfileEvents(data.events || []);
    } catch (err) {
      console.error(err);
      showError("Failed to load profile events");
    }
  }

  async function handleCreateAudience(e: React.FormEvent) {
    e.preventDefault();
    try {
      const def = JSON.parse(audDef);
      const res = await fetch(`${API_BASE}/audiences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: audName,
          definition: def,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to create audience");
      }

      showMessage("Audience created");
      setAudName("");
      await fetchAudiences();
    } catch (err: any) {
      console.error(err);
      showError(err.message || "Error creating audience");
    }
  }

  async function handleRebuildAudience(id: number) {
    try {
      const res = await fetch(`${API_BASE}/audiences/${id}/rebuild`, {
        method: "POST",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to rebuild audience");
      }

      const body = await res.json();
      showMessage(`Rebuilt audience ${id}, added ${body.added_members} members`);
      await fetchAudiences();
    } catch (err: any) {
      console.error(err);
      showError(err.message || "Error rebuilding audience");
    }
  }

  function handleExportAudience(id: number) {
    // Just open the CSV in a new tab
    window.open(`${API_BASE}/audiences/${id}/export`, "_blank");
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "1.5rem", maxWidth: 1200, margin: "0 auto" }}>
      <h1>Mini CDP Demo</h1>
      <p style={{ color: "#555" }}>
        Collect → Unify → Segment → Activate, backed by your Node + Postgres mini CDP.
      </p>

      {message && (
        <div style={{ background: "#e6ffed", border: "1px solid #2ecc71", padding: "0.5rem 0.75rem", marginBottom: "1rem" }}>
          {message}
        </div>
      )}
      {error && (
        <div style={{ background: "#ffecec", border: "1px solid #e74c3c", padding: "0.5rem 0.75rem", marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "1rem", alignItems: "flex-start" }}>
        {/* Left column: forms + audiences */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: "1rem" }}>
            <h2>Identify / Upsert Profile</h2>
            <form onSubmit={handleIdentify} style={{ display: "grid", gap: "0.5rem" }}>
              <div>
                <label>Email</label>
                <input
                  type="email"
                  value={idEmail}
                  onChange={(e) => setIdEmail(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label>User ID</label>
                <input
                  type="text"
                  value={idUserId}
                  onChange={(e) => setIdUserId(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label>Anonymous ID</label>
                <input
                  type="text"
                  value={idAnon}
                  onChange={(e) => setIdAnon(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label>Traits (JSON)</label>
                <textarea
                  value={idTraits}
                  onChange={(e) => setIdTraits(e.target.value)}
                  rows={3}
                  style={{ width: "100%", fontFamily: "monospace" }}
                />
              </div>
              <button type="submit" style={{ padding: "0.4rem 0.8rem" }}>
                Save Profile
              </button>
            </form>
          </section>

          <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: "1rem" }}>
            <h2>Track Event</h2>
            <form onSubmit={handleTrack} style={{ display: "grid", gap: "0.5rem" }}>
              <div>
                <label>Event Type</label>
                <input
                  type="text"
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                  style={{ width: "100%" }}
                />
                <small>Try "page_view" or "purchase"</small>
              </div>
              <div>
                <label>User ID</label>
                <input
                  type="text"
                  value={evUserId}
                  onChange={(e) => setEvUserId(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label>Anonymous ID</label>
                <input
                  type="text"
                  value={evAnon}
                  onChange={(e) => setEvAnon(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label>Amount (for purchase)</label>
                <input
                  type="number"
                  step="0.01"
                  value={evAmount}
                  onChange={(e) => setEvAmount(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label>Properties (JSON)</label>
                <textarea
                  value={evProps}
                  onChange={(e) => setEvProps(e.target.value)}
                  rows={3}
                  style={{ width: "100%", fontFamily: "monospace" }}
                />
              </div>
              <button type="submit" style={{ padding: "0.4rem 0.8rem" }}>
                Track Event
              </button>
            </form>
          </section>

          <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: "1rem" }}>
            <h2>Audiences</h2>

            <form onSubmit={handleCreateAudience} style={{ display: "grid", gap: "0.5rem", marginBottom: "1rem" }}>
              <div>
                <label>Name</label>
                <input
                  type="text"
                  value={audName}
                  onChange={(e) => setAudName(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label>Definition (JSON)</label>
                <textarea
                  value={audDef}
                  onChange={(e) => setAudDef(e.target.value)}
                  rows={4}
                  style={{ width: "100%", fontFamily: "monospace" }}
                />
              </div>
              <button type="submit" style={{ padding: "0.4rem 0.8rem" }}>
                Create Audience
              </button>
            </form>

            <div>
              <h3>Existing Audiences</h3>
              {audiences.length === 0 ? (
                <p style={{ color: "#777" }}>No audiences yet.</p>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {audiences.map((a) => (
                    <li
                      key={a.id}
                      style={{
                        borderBottom: "1px solid #eee",
                        padding: "0.5rem 0",
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "0.5rem",
                      }}
                    >
                      <div>
                        <div>
                          <strong>{a.name}</strong> (id: {a.id})
                        </div>
                        <div style={{ fontSize: 12, color: "#777" }}>
                          Last built: {a.last_built_at || "never"}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "0.25rem" }}>
                        <button
                          type="button"
                          onClick={() => handleRebuildAudience(a.id)}
                          style={{ padding: "0.25rem 0.5rem" }}
                        >
                          Rebuild
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExportAudience(a.id)}
                          style={{ padding: "0.25rem 0.5rem" }}
                        >
                          Export CSV
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>

        {/* Right column: profiles list + details */}
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: "1rem", maxHeight: "80vh", overflowY: "auto" }}>
          <h2>Profiles</h2>
          {profiles.length === 0 ? (
            <p style={{ color: "#777" }}>No profiles yet. Use the forms on the left to create one.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "0.5rem" }}>
              {profiles.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectProfile(p)}
                  style={{
                    textAlign: "left",
                    padding: "0.5rem",
                    borderRadius: 6,
                    border:
                      selectedProfile && selectedProfile.id === p.id
                        ? "2px solid #3498db"
                        : "1px solid #ddd",
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  <div>
                    <strong>{p.email || p.user_id || p.anonymous_id || "(no ID)"}</strong>
                  </div>
                  <div style={{ fontSize: 12, color: "#777" }}>
                    Orders: {p.total_orders} · Spend: {String(p.total_spend)} · Last seen:{" "}
                    {p.last_seen_at ? new Date(p.last_seen_at).toLocaleString() : "n/a"}
                  </div>
                </button>
              ))}
            </div>
          )}

          {selectedProfile && (
            <div style={{ marginTop: "1rem" }}>
              <h3>Selected Profile</h3>
              <pre
                style={{
                  background: "#f9f9f9",
                  padding: "0.5rem",
                  borderRadius: 4,
                  fontSize: 12,
                  overflowX: "auto",
                }}
              >
                {JSON.stringify(selectedProfile, null, 2)}
              </pre>

              <h4>Events</h4>
              {profileEvents.length === 0 ? (
                <p style={{ color: "#777" }}>No events yet.</p>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {profileEvents.map((ev) => (
                    <li
                      key={ev.id}
                      style={{
                        borderBottom: "1px solid #eee",
                        padding: "0.5rem 0",
                      }}
                    >
                      <div>
                        <strong>{ev.event_type}</strong> ·{" "}
                        {new Date(ev.occurred_at).toLocaleString()}
                      </div>
                      <pre
                        style={{
                          background: "#f4f4f4",
                          padding: "0.25rem 0.5rem",
                          borderRadius: 4,
                          fontSize: 11,
                          overflowX: "auto",
                        }}
                      >
                        {JSON.stringify(ev.properties, null, 2)}
                      </pre>
                    </li>
                  ))}
                </ul>
              )}

<h4>Audiences</h4>
              {audiences.length === 0 ? (
                <p style={{ color: "#777" }}>No audiences yet.</p>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {audiences.map((a) => (
                    <li key={a.id} style={{ borderBottom: "1px solid #eee", padding: "0.5rem 0" }}>
                      <div><strong>{a.name}</strong> (id: {a.id})</div>
                      <pre
                        style={{
                          background: "#f4f4f4",
                          padding: "0.25rem 0.5rem",
                          borderRadius: 4,
                          fontSize: 11,
                          overflowX: "auto",
                        }}
                      >
                        {JSON.stringify(a.definition, null, 2)}
                      </pre>
                    </li>
                  ))}
                </ul>
              )}


            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
