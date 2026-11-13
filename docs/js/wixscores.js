// Leaderboard on the Ten Telescopes Wix site (CMS collection "SkywardScores").
// The client id is public by design (Wix headless): it can only mint an anonymous *visitor* token.
// The collection allows anyone to add and read rows; only the site owner can edit or delete them.
// Endpoints: Wix Headless "Retrieve Tokens" and Wix Data Items v2 (insert, query).
export const WIX = {
  clientId: 'b65020c1-531f-4fa9-b232-d6e68f0b2dfa',
  collection: 'SkywardScores',
  base: 'https://www.wixapis.com',
};

let tok = null; // {access, refresh, exp}

async function post(path, body, auth) {
  const r = await fetch(WIX.base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify(body),
  });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
  if (!r.ok) { const e = new Error((json && (json.message || json.details?.applicationError?.description)) || `HTTP ${r.status}`); e.status = r.status; throw e; }
  return json;
}

/** Visitor token, renewed with the refresh token (never re-minted each time, per Wix guidance). */
export async function visitorToken(store) {
  const now = Date.now();
  if (!tok && store && store.wixToken) tok = store.wixToken;
  if (tok && tok.exp > now + 60000) return tok.access;
  let r;
  if (tok && tok.refresh) {
    try { r = await post('/oauth2/token', { clientId: WIX.clientId, grantType: 'refresh_token', refreshToken: tok.refresh }); } catch (e) { r = null; }
  }
  if (!r) r = await post('/oauth2/token', { clientId: WIX.clientId, grantType: 'anonymous' });
  tok = { access: r.access_token, refresh: r.refresh_token, exp: now + (r.expires_in || 3600) * 1000 };
  if (store) store.wixToken = tok;
  return tok.access;
}

/** Add one score row. `row` uses the collection's field keys. */
export async function submitScore(row, store) {
  const auth = await visitorToken(store);
  const data = { ...row, playedAt: { $date: new Date(row.playedAt || Date.now()).toISOString() } };
  const r = await post('/wix-data/v2/items', { dataCollectionId: WIX.collection, dataItem: { data } }, auth);
  return r.dataItem && r.dataItem.id;
}

/** Leaderboard rows: one challenge, or recent games of one style. Best first. */
export async function fetchBoard({ challenge = null, style = null, limit = 50 }, store) {
  const auth = await visitorToken(store);
  const filter = challenge ? { challenge: { $eq: challenge } } : style ? { style: { $eq: style } } : {};
  const body = { dataCollectionId: WIX.collection, query: { filter, sort: [{ fieldName: 'points', order: 'DESC' }], paging: { limit } } };
  const r = await post('/wix-data/v2/items/query', body, auth);
  return (r.dataItems || []).map((d) => d.data);
}

/** Send any scores queued while offline. Returns how many went through. */
export async function flushQueue(store) {
  const q = store.pendingScores || []; let sent = 0;
  while (q.length) {
    try { await submitScore(q[0], store); q.shift(); sent++; } catch (e) { if (e.status && e.status < 500 && e.status !== 429) { q.shift(); } break; }
  }
  store.pendingScores = q; return sent;
}
