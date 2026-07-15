// netlify/functions/roster.mjs
//
// Shared backend for the roster tracker. Uses Netlify Blobs so every
// teammate who opens the dashboard sees the same live snapshot, and every
// upload is diffed against that shared state (not just the uploader's browser).
//
// GET  /api/roster            -> { snapshot, history, alerts }  (current state, no upload)
// POST /api/roster { locations, uploadedBy } -> parses+diffs the new roster,
//                                                stores it, returns the same shape
//                                                plus the diff for this upload.

import { getStore } from "@netlify/blobs";

const SNAPSHOT_KEY = "latest-snapshot";
const HISTORY_KEY = "upload-history";
const MAX_HISTORY = 200;

function store() {
  return getStore("roster-tracker");
}

// Pull a clean "who's on the roster" list out of a parsed location record.
// Every entry is tagged with location + section so we can diff sensibly
// (e.g. someone moving from Akron to Columbus shows as "moved", not two
// unrelated new/departed events).
function flattenStaff(location) {
  const staff = [];
  const add = (name, role, section) => {
    if (!name) return;
    const clean = String(name).trim();
    if (!clean || /^open hire$/i.test(clean)) return;
    staff.push({ name: clean, role: role || "", section, location: location.location });
  };

  (location.adminRoles || []).forEach((r) => add(r.name, r.role, "Administrative"));
  (location.caseAssignments || []).forEach((r) => add(r.name, r.role, "Case Assignment"));
  (location.prnStaff || []).forEach((r) => add(r.name, r.role, "PRN"));

  return staff;
}

function diffSnapshots(prevLocations, nextLocations) {
  const prevStaff = new Map(); // name(lowercased) -> {name, role, section, location}
  const nextStaff = new Map();

  (prevLocations || []).forEach((loc) => {
    flattenStaff(loc).forEach((s) => prevStaff.set(s.name.toLowerCase(), s));
  });
  (nextLocations || []).forEach((loc) => {
    flattenStaff(loc).forEach((s) => nextStaff.set(s.name.toLowerCase(), s));
  });

  const added = [];
  const removed = [];
  const moved = [];

  for (const [key, s] of nextStaff.entries()) {
    if (!prevStaff.has(key)) {
      added.push(s);
    } else {
      const prev = prevStaff.get(key);
      if (prev.location !== s.location) {
        moved.push({ name: s.name, role: s.role, from: prev.location, to: s.location });
      }
    }
  }
  for (const [key, s] of prevStaff.entries()) {
    if (!nextStaff.has(key)) removed.push(s);
  }

  return { added, removed, moved };
}

// Very first-pass ratio heuristic — flags a role as "approaching" or
// "needs opening" per location, based on the ratio text already in the
// sheet (e.g. "Ratio: 1:10 RN & Aide") vs. current census and how many
// distinct people are assigned to that role across the case-assignment grid.
// This is meant to be tuned once real ratio rules are nailed down.
function computeAlerts(locations) {
  const alerts = [];
  for (const loc of locations || []) {
    const ratioMatch = (loc.ratioText || "").match(/1\s*:\s*(\d+)/);
    const ratio = ratioMatch ? parseInt(ratioMatch[1], 10) : null;
    const census = Number(loc.currentCensus) || 0;
    if (!ratio || !census) continue;

    const roleCounts = {};
    (loc.caseAssignments || []).forEach((r) => {
      if (!r.name || /^open hire$/i.test(r.name.trim())) return;
      const key = r.role || "Unassigned";
      roleCounts[key] = roleCounts[key] || new Set();
      roleCounts[key].add(r.name.trim().toLowerCase());
    });

    for (const role of ["RN Case Manager", "Hospice Aide"]) {
      const headcount = roleCounts[role] ? roleCounts[role].size : 0;
      const capacity = headcount * ratio;
      if (capacity === 0) {
        alerts.push({
          location: loc.location,
          role,
          level: "critical",
          message: `${loc.location}: no ${role} assigned — census ${census} has no coverage.`,
        });
      } else if (census > capacity) {
        alerts.push({
          location: loc.location,
          role,
          level: "critical",
          message: `${loc.location}: ${role} ratio exceeded — ${headcount} staff / ${ratio} ratio = ${capacity} capacity, census is ${census}. Needs opening.`,
        });
      } else if (census >= capacity * 0.9) {
        alerts.push({
          location: loc.location,
          role,
          level: "warning",
          message: `${loc.location}: ${role} approaching capacity — ${headcount} staff covering census ${census} (capacity ${capacity}).`,
        });
      }
    }
  }
  return alerts;
}

export default async (req) => {
  const s = store();

  if (req.method === "GET") {
    const snapshot = (await s.get(SNAPSHOT_KEY, { type: "json" })) || { locations: [], updatedAt: null };
    const history = (await s.get(HISTORY_KEY, { type: "json" })) || [];
    const alerts = computeAlerts(snapshot.locations);
    return Response.json({ snapshot, history, alerts });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { locations, uploadedBy } = body || {};
    if (!Array.isArray(locations)) {
      return Response.json({ error: "Expected { locations: [...] }" }, { status: 400 });
    }

    const prevSnapshot = (await s.get(SNAPSHOT_KEY, { type: "json" })) || { locations: [] };
    const diff = diffSnapshots(prevSnapshot.locations, locations);

    const newSnapshot = { locations, updatedAt: new Date().toISOString(), uploadedBy: uploadedBy || "Unknown" };
    await s.setJSON(SNAPSHOT_KEY, newSnapshot);

    const history = (await s.get(HISTORY_KEY, { type: "json" })) || [];
    const entry = {
      at: newSnapshot.updatedAt,
      uploadedBy: newSnapshot.uploadedBy,
      added: diff.added,
      removed: diff.removed,
      moved: diff.moved,
    };
    const newHistory = [entry, ...history].slice(0, MAX_HISTORY);
    await s.setJSON(HISTORY_KEY, newHistory);

    const alerts = computeAlerts(locations);
    return Response.json({ snapshot: newSnapshot, history: newHistory, alerts, diff: entry });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config = { path: "/.netlify/functions/roster" };
