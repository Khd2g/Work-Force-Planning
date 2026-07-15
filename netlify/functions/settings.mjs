// netlify/functions/settings.mjs
//
// Stores census, ratio, and planned-hiring targets per location. None of
// these live in the Employee Basic export, so they're kept separate and
// survive across uploads (an upload only ever touches employees).
//
// POST /api/settings { location, census, ratio, plannedHiring } -> merges
// and returns the full settings map. plannedHiring is a 12-length array
// of monthly targets (Jan..Dec), all optional per field.

import { getStore } from "@netlify/blobs";

const SETTINGS_KEY = "location-settings";

export default async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { location, census, ratio, plannedHiring } = body || {};
  if (!location) {
    return Response.json({ error: "Expected { location, census, ratio, plannedHiring }" }, { status: 400 });
  }

  const s = getStore("roster-tracker");
  const settings = (await s.get(SETTINGS_KEY, { type: "json" })) || {};
  const prev = settings[location] || {};
  settings[location] = {
    census: census === "" || census === undefined ? prev.census ?? null : Number(census),
    ratio: ratio === "" || ratio === undefined ? prev.ratio ?? null : Number(ratio),
    plannedHiring: Array.isArray(plannedHiring) ? plannedHiring.map((v) => Number(v) || 0) : (prev.plannedHiring || Array(12).fill(0)),
  };
  await s.setJSON(SETTINGS_KEY, settings);

  return Response.json({ settings });
};

export const config = { path: "/.netlify/functions/settings" };
