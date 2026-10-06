// Thin wrapper around the local launcher API.

const token = document.querySelector('meta[name="gamehub-token"]')?.content || "";

async function request(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "X-GameHub-Token": token, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  state: () => request("/api/state"),
  status: () => request("/api/status"),
  launch: (id) => request("/api/launch", { id }),
  meta: (id, patch) => request("/api/meta", { id, ...patch }),
  settings: (patch) => request("/api/settings", patch),
  rescan: () => request("/api/rescan", {}),
  addCustom: (game) => request("/api/custom/add", game),
  removeCustom: (id) => request("/api/custom/remove", { id }),
  power: (action) => request("/api/power", { action }),
};
