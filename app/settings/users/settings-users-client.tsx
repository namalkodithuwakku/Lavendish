"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../auth-provider";
import { PAGE_OPTIONS } from "../../page-access";

const hotelOptions = [
  { code: "MLR", name: "Miridiya Lake Resort" },
  { code: "GTL", name: "Grand Tamarind Lake" },
  { code: "LOH", name: "Lavendish Okrin Hotel" },
  { code: "LWS", name: "Lavendish Wild Safari" },
  { code: "LWW", name: "Lavendish Wild Wilpattu" },
  { code: "LCR", name: "Lavendish Country Resort" },
  { code: "LLG", name: "Lavendish Lake Giritale" },
  { code: "LHK", name: "Lavendish Hills Kandy" },
  { code: "TLK", name: "Tamarind Lifestyle - Kataragama" },
  { code: "LBU", name: "Lavendish Beach Unawatuna" },
];

type Role = "MASTER_ADMIN" | "HEAD_OFFICE" | "GM" | "VIEWER";
type User = {
  id: string;
  name: string;
  email: string;
  password: string;
  role: Role;
  hotels: string[];
  pages: string[];
  active: boolean;
};

const blank: User = {
  id: "",
  name: "",
  email: "",
  password: "",
  role: "GM",
  hotels: [],
  pages: ["HOTEL_OCCUPANCY"],
  active: true,
};

const roleLabel: Record<Role, string> = {
  MASTER_ADMIN: "Master Admin",
  HEAD_OFFICE: "Head Office",
  GM: "General Manager",
  VIEWER: "Viewer",
};

export function SettingsUsersClient() {
  const { access, session } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [editing, setEditing] = useState<User | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function api(options?: RequestInit) {
    if (!session) throw new Error("Session expired");
    const response = await fetch("/api/admin/users", {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        ...options?.headers,
      },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Request failed");
    return data;
  }

  useEffect(() => {
    if (!session || access?.role !== "MASTER_ADMIN") return;
    let active = true;
    setLoading(true);
    api()
      .then((data) => {
        if (active)
          setUsers(
            data.users.map((user: Omit<User, "password">) => ({
              ...user,
              pages: user.pages?.length ? user.pages : ["HOTEL_OCCUPANCY"],
              password: "",
            })),
          );
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session, access?.role]);

  function toggleHotel(code: string) {
    setEditing((user) =>
      user
        ? {
            ...user,
            hotels: user.hotels.includes(code)
              ? user.hotels.filter((item) => item !== code)
              : [...user.hotels.filter((item) => item !== "ALL"), code],
          }
        : user,
    );
  }

  function togglePage(code: string) {
    setEditing((user) =>
      user
        ? {
            ...user,
            pages: user.pages.includes(code)
              ? user.pages.filter((item) => item !== code)
              : [...user.pages.filter((item) => item !== "ALL"), code],
          }
        : user,
    );
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError("");
    try {
      const data = await api({
        method: editing.id ? "PATCH" : "POST",
        body: JSON.stringify(editing),
      });
      const next = { ...data.user, password: "" } as User;
      setUsers((current) =>
        editing.id
          ? current.map((user) => (user.id === next.id ? next : user))
          : [...current, next].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setNotice(
        editing.id
          ? `${next.name}'s account was updated.`
          : `${next.name} can now sign in.`,
      );
      setEditing(null);
      window.setTimeout(() => setNotice(""), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save user");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="intel-page settings-users-page">
      <section className="intel-intro">
        <div>
          <h2>User control</h2>
          <p>Create accounts and choose the hotels and pages each person can access.</p>
        </div>
        <button
          className="intel-primary"
          onClick={() => {
            setError("");
            setEditing({ ...blank, pages: [...blank.pages] });
          }}
        >
          + Create user
        </button>
      </section>

      <section className="admin-stats">
        <article><span>Total users</span><b>{users.length}</b><small>Supabase accounts</small></article>
        <article><span>Active users</span><b>{users.filter((user) => user.active).length}</b><small>Allowed to sign in</small></article>
        <article><span>Full portfolio</span><b>{users.filter((user) => user.hotels.includes("ALL")).length}</b><small>All 10 hotels</small></article>
        <article><span>Page control</span><b className="status-word">Live</b><small>Master controlled</small></article>
      </section>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <div><h2>Authorized users</h2><p>Hotel access and page access are controlled separately.</p></div>
        </div>
        {error && !editing && <div className="admin-inline-error">{error}</div>}
        {loading ? (
          <div className="admin-empty">Loading authorized users...</div>
        ) : (
          <div className="users-table">
            <div className="users-head"><span>User</span><span>Role</span><span>Hotel access</span><span>Page access</span><span>Status</span><span /></div>
            {users.map((user) => (
              <div className="users-row" key={user.id}>
                <div className="user-name"><span>{user.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span><div><b>{user.name}</b><small>{user.email}</small></div></div>
                <span className={`role-pill ${user.role.toLowerCase()}`}>{roleLabel[user.role]}</span>
                <div className="access-summary">{user.hotels.includes("ALL") ? <b>All 10 hotels</b> : <><b>{user.hotels.length} hotels</b><small>{user.hotels.join(" / ") || "No access"}</small></>}</div>
                <div className="access-summary">{user.pages.includes("ALL") ? <b>All pages</b> : <><b>{user.pages.length} pages</b><small>{user.pages.map((code) => PAGE_OPTIONS.find((page) => page.code === code)?.label ?? code).join(" / ")}</small></>}</div>
                <span className={`profile-status ${user.active ? "active" : "inactive"}`}>{user.active ? "Active" : "Inactive"}</span>
                <button className="edit-button" onClick={() => { setError(""); setEditing({ ...user, password: "", hotels: [...user.hotels], pages: [...user.pages] }); }}>Edit</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {editing && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target && !saving) setEditing(null); }}>
          <form className="profile-modal user-modal" onSubmit={save}>
            <div className="modal-head"><div><p>USER ACCOUNT</p><h2>{editing.id ? "Edit user" : "Create user"}</h2></div><button type="button" disabled={saving} onClick={() => setEditing(null)}>x</button></div>
            {error && <div className="admin-inline-error modal-error">{error}</div>}
            <div className="form-grid">
              <label><span>Full name *</span><input required value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
              <label><span>Email address *</span><input required type="email" value={editing.email} onChange={(event) => setEditing({ ...editing, email: event.target.value })} /></label>
              <label className="wide"><span>{editing.id ? "New password (optional)" : "Initial password *"}</span><input required={!editing.id} minLength={8} type="password" autoComplete="new-password" value={editing.password} onChange={(event) => setEditing({ ...editing, password: event.target.value })} /><small>{editing.id ? "Leave blank to keep the current password." : "Minimum 8 characters."}</small></label>
              <label><span>Role *</span><select value={editing.role} onChange={(event) => { const role = event.target.value as Role; setEditing({ ...editing, role, pages: role === "MASTER_ADMIN" ? ["ALL"] : editing.pages.includes("ALL") ? ["HOTEL_OCCUPANCY"] : editing.pages }); }}><option value="MASTER_ADMIN">Master Admin</option><option value="HEAD_OFFICE">Head Office</option><option value="GM">General Manager</option><option value="VIEWER">Viewer</option></select></label>
              <label><span>Account status</span><select value={editing.active ? "Active" : "Inactive"} onChange={(event) => setEditing({ ...editing, active: event.target.value === "Active" })}><option>Active</option><option>Inactive</option></select></label>
            </div>

            <div className="hotel-access-title"><div><b>Hotel access *</b><small>Select one, several, or all hotels.</small></div><button type="button" className={editing.hotels.includes("ALL") ? "selected" : ""} onClick={() => setEditing({ ...editing, hotels: ["ALL"] })}>All 10 hotels</button></div>
            <div className="hotel-check-grid">{hotelOptions.map((hotel) => <label className={editing.hotels.includes("ALL") || editing.hotels.includes(hotel.code) ? "selected" : ""} key={hotel.code}><input type="checkbox" checked={editing.hotels.includes("ALL") || editing.hotels.includes(hotel.code)} disabled={editing.hotels.includes("ALL")} onChange={() => toggleHotel(hotel.code)} /><span>{hotel.code}</span><b>{hotel.name}</b></label>)}</div>

            <div className="hotel-access-title page-access-title"><div><b>Page access *</b><small>Select the screens this user can see and open.</small></div>{editing.role === "MASTER_ADMIN" ? <span className="master-page-note">All pages required</span> : <button type="button" className={editing.pages.includes("ALL") ? "selected" : ""} onClick={() => setEditing({ ...editing, pages: ["ALL"] })}>All pages</button>}</div>
            <div className="page-check-grid">{PAGE_OPTIONS.map((page) => <label className={editing.pages.includes("ALL") || editing.pages.includes(page.code) ? "selected" : ""} key={page.code}><input type="checkbox" checked={editing.pages.includes("ALL") || editing.pages.includes(page.code)} disabled={editing.pages.includes("ALL") || editing.role === "MASTER_ADMIN"} onChange={() => togglePage(page.code)} /><span><b>{page.label}</b><small>{page.href}</small></span></label>)}</div>

            <div className="modal-actions"><button type="button" disabled={saving} onClick={() => setEditing(null)}>Cancel</button><button className="save-profile" type="submit" disabled={saving || !editing.hotels.length || !editing.pages.length}>{saving ? "Saving securely..." : editing.id ? "Update user" : "Create user and login"}</button></div>
          </form>
        </div>
      )}
      {notice && <div className="admin-toast">Saved - {notice}</div>}
    </div>
  );
}
