/**
 * Halonix Smart Bulb controller for AWS Lambda (Node.js 20+, Function URL).
 *
 * Controls a Tuya-based bulb (Halonix, Smart Life, ...) through Tuya's cloud
 * API, so it works from anywhere. The same function serves the control page
 * at "/" and a small JSON API under "/api/". Schedules are stored as Tuya
 * cloud timers, so they run even when nobody has the page open.
 *
 * Handler: index.handler (the Lambda console default)
 *
 * Environment variables (Lambda -> Configuration -> Environment variables):
 *   TUYA_ACCESS_ID      Access ID / Client ID of your Tuya cloud project
 *   TUYA_ACCESS_SECRET  Access Secret / Client Secret of that project
 *   APP_PASSWORD        optional: password for the control page (8+ characters).
 *                       Leave it out and the page opens without a password.
 *   TUYA_REGION         optional, default "in" (India). us, us-e, eu, eu-w, cn, sg
 *   DEVICE_ID           optional, which device to control (default: first light)
 *   TIMEZONE            optional, default "Asia/Kolkata"
 *   TZ_OFFSET           optional, default "+05:30" (must match TIMEZONE)
 *
 * No npm packages: only what ships with Node.js.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

const REGIONS = {
  in: 'openapi.tuyain.com',
  us: 'openapi.tuyaus.com',
  'us-e': 'openapi-ueaz.tuyaus.com',
  eu: 'openapi.tuyaeu.com',
  'eu-w': 'openapi-weaz.tuyaeu.com',
  cn: 'openapi.tuyacn.com',
  sg: 'openapi-sg.iotbing.com',
};
const LIGHT_CATEGORIES = new Set(['dj', 'dd', 'fwd', 'dc', 'xdd', 'fwl', 'tgq', 'tgkg', 'gyd', 'sxd', 'dsd']);
const SCHEDULE_CATEGORY = 'halonix_web';
const SESSION_DAYS = 30;
const SPEC_TTL_MS = 3600 * 1000;
const TOKEN_RETRY_CODES = new Set([1010, 1011, 1012]);
const EFFECTS = ['rainbow', 'breathe', 'candle', 'party', 'ocean', 'aurora'];

// ---------------------------------------------------------------- helpers

const env = (name, fallback = '') => (process.env[name] || fallback).trim();
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha256hex = text => createHash('sha256').update(text, 'utf8').digest('hex');
const hmacHex = (key, text) => createHmac('sha256', key).update(text, 'utf8').digest('hex');

class ConfigError extends Error {}   // something is missing in the Lambda settings
class BadRequest extends Error {}
class TuyaError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

function num(body, key, lo, hi, fallback) {
  const raw = body?.[key] ?? fallback;
  if (raw === undefined || raw === null) throw new BadRequest(`Missing '${key}'`);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new BadRequest(`'${key}' must be a number`);
  return clamp(value, lo, hi);
}

const TUYA_HINTS = {
  1004: 'Tuya rejected the request signature. Check TUYA_ACCESS_ID and TUYA_ACCESS_SECRET in the Lambda environment variables.',
  1013: 'Tuya says the request time is wrong. Try again in a minute.',
  2009: "TUYA_ACCESS_ID isn't right. It must be the Access ID/Client ID (first box on your Tuya project's Overview page), not the Project Code or the secret, and TUYA_REGION must match the project's data center.",
  1106: "Tuya says this project has no permission for that device. Check the bulb is listed under your project's Devices tab (Link App Account) and that TUYA_REGION matches the project's data center.",
  2001: 'Your bulb is offline. Check it is switched on at the wall and its Wi-Fi works.',
  2008: "Your bulb doesn't support that command.",
  28841002: "Tuya's free trial for this cloud project has expired. Open platform.tuya.com -> Cloud -> your project and extend the IoT Core trial (free), then try again.",
  28841101: "This Tuya project isn't allowed to use that API yet. Open platform.tuya.com -> Cloud -> your project -> Service API, and authorize the missing service.",
  28841105: "This Tuya project isn't allowed to use that API yet. Open platform.tuya.com -> Cloud -> your project -> Service API, and authorize the missing service.",
};

function tuyaMessage(code, msg) {
  const raw = `Tuya: ${msg || 'error'} (code ${code})`;
  return TUYA_HINTS[code] ? `${TUYA_HINTS[code]} ${raw}` : raw;
}

function offsetMinutes() {
  const m = /^([+-])(\d{1,2}):?(\d{2})$/.exec(env('TZ_OFFSET', '+05:30'));
  if (!m) throw new ConfigError('TZ_OFFSET must look like +05:30');
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '+' ? minutes : -minutes;
}

// "now" in the bulb's time zone, as a Date whose UTC fields hold the local time
const localNow = () => new Date(Date.now() + offsetMinutes() * 60000);
const pad = n => String(n).padStart(2, '0');

// ---------------------------------------------------------------- Tuya cloud client

class Tuya {
  constructor() {
    this.accessId = env('TUYA_ACCESS_ID');
    this.secret = env('TUYA_ACCESS_SECRET');
    const region = env('TUYA_REGION', 'in').toLowerCase();
    if (!this.accessId || !this.secret) {
      throw new ConfigError('Add TUYA_ACCESS_ID and TUYA_ACCESS_SECRET in Lambda -> Configuration -> Environment variables.');
    }
    if (!REGIONS[region]) throw new ConfigError(`TUYA_REGION must be one of: ${Object.keys(REGIONS).join(', ')}`);
    this.host = REGIONS[region];
    this.token = null;
    this.tokenUntil = 0;
  }

  // Tuya's 2021+ signing scheme
  sign(method, urlPath, payload, t, token) {
    const stringToSign = [method, sha256hex(payload), '', urlPath].join('\n');
    return hmacHex(this.secret, this.accessId + token + t + stringToSign).toUpperCase();
  }

  async http(method, url, headers, body) {
    let res;
    try {
      res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(8000) });
    } catch (e) {
      throw new TuyaError(`Couldn't reach Tuya's cloud (${e.name === 'TimeoutError' ? 'timed out' : e.message}). Try again.`);
    }
    try {
      return await res.json();
    } catch (_) {
      throw new TuyaError(`Tuya cloud returned HTTP ${res.status}`);
    }
  }

  async request(method, path, query, body, auth = true) {
    let signQuery = '', urlQuery = '';
    if (query) {
      const keys = Object.keys(query).sort();
      // the signature uses the raw values; the URL gets them encoded
      signQuery = '?' + keys.map(k => `${k}=${query[k]}`).join('&');
      urlQuery = '?' + keys.map(k => `${k}=${encodeURIComponent(String(query[k]))}`).join('&');
    }
    const payload = body === undefined || body === null ? '' : JSON.stringify(body);
    const token = auth ? await this.getToken() : '';
    const t = String(Date.now());
    const headers = {
      client_id: this.accessId,
      sign: this.sign(method, path + signQuery, payload, t, token),
      t,
      sign_method: 'HMAC-SHA256',
    };
    if (token) headers.access_token = token;
    if (payload) headers['Content-Type'] = 'application/json';
    const result = await this.http(method, `https://${this.host}${path}${urlQuery}`, headers, payload || undefined);
    if (!result || typeof result !== 'object') throw new TuyaError("Unexpected reply from Tuya's cloud");
    if (!result.success) throw new TuyaError(tuyaMessage(result.code, result.msg), result.code);
    return result.result;
  }

  async getToken() {
    if (this.token && Date.now() < this.tokenUntil - 60000) return this.token;
    const result = await this.request('GET', '/v1.0/token', { grant_type: 1 }, undefined, false);
    this.token = result.access_token;
    this.tokenUntil = Date.now() + Number(result.expire_time || 7200) * 1000;
    return this.token;
  }

  async call(method, path, query, body) {
    try {
      return await this.request(method, path, query, body);
    } catch (e) {
      if (!(e instanceof TuyaError) || !TOKEN_RETRY_CODES.has(e.code)) throw e;
      this.token = null;
      return this.request(method, path, query, body);
    }
  }
}

let tuyaClient = null;
function tuya() {
  if (!tuyaClient) tuyaClient = new Tuya();
  return tuyaClient;
}

// ---------------------------------------------------------------- the bulb

const cache = { deviceId: null, spec: null, specAt: 0, sceneShape: null };

async function listDevices() {
  const out = [];
  const query = { size: 50 };
  for (let page = 0; page < 5; page++) {
    const result = (await tuya().call('GET', '/v1.0/iot-01/associated-users/devices', query)) || {};
    out.push(...(result.devices || result.list || []));
    if (!result.has_more || !result.last_row_key) break;
    query.last_row_key = result.last_row_key;
  }
  return out;
}

async function deviceId() {
  const chosen = env('DEVICE_ID');
  if (chosen) return chosen;
  if (!cache.deviceId) {
    const devices = await listDevices();
    const lights = devices.filter(d => LIGHT_CATEGORIES.has(d.category));
    const pick = (lights.length ? lights : devices)[0];
    if (!pick) {
      throw new ConfigError('No devices found in your Tuya project. In platform.tuya.com open your project -> ' +
        'Devices -> Link App Account, and link your Smart Life account.');
    }
    cache.deviceId = pick.id;
  }
  return cache.deviceId;
}

function parseJson(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { const v = JSON.parse(raw || '{}'); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; }
}
const first = (codes, ...names) => names.find(n => n in codes) || null;

// Two Tuya addresses report the bulb's settings, and not every project may use both,
// so use the one the page already loads with and fall back to the other.
async function readStatus(did) {
  try {
    const info = (await tuya().call('GET', `/v1.0/devices/${did}`)) || {};
    if (Array.isArray(info.status)) return info.status;
  } catch (e) {
    if (!(e instanceof TuyaError)) throw e;
  }
  return readStatusV2(did);
}

async function readStatusV2(did) {
  return (await tuya().call('GET', `/v1.0/iot-03/devices/${did}/status`)) || [];
}

// which data-point codes this bulb uses, and their value ranges
async function lightSpec(did) {
  if (cache.spec && cache.spec.id === did && Date.now() - cache.specAt < SPEC_TTL_MS) return cache.spec;
  let funcs = {};
  try {
    const result = (await tuya().call('GET', `/v1.0/iot-03/devices/${did}/functions`)) || {};
    for (const f of result.functions || []) if (f.code) funcs[f.code] = parseJson(f.values);
  } catch (e) {
    if (!(e instanceof TuyaError)) throw e;
  }
  if (!Object.keys(funcs).length) {  // fall back to whatever the status reports
    for (const s of await readStatus(did)) if (s.code) funcs[s.code] = {};
  }
  const v2 = 'bright_value_v2' in funcs || 'colour_data_v2' in funcs;
  const spec = {
    id: did,
    switch: first(funcs, 'switch_led', 'switch', 'switch_1'),
    mode: first(funcs, 'work_mode'),
    bright: first(funcs, 'bright_value_v2', 'bright_value', 'bright_value_1'),
    temp: first(funcs, 'temp_value_v2', 'temp_value'),
    colour: first(funcs, 'colour_data_v2', 'colour_data'),
    scene: first(funcs, 'scene_data_v2'),
    countdown: first(funcs, 'countdown_1', 'countdown'),
  };
  if (!spec.switch) throw new TuyaError("This device doesn't look like a light (no on/off switch found).");
  const defMax = v2 ? 1000 : 255;
  const intOr = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.trunc(Number(v)) : d);
  const b = funcs[spec.bright] || {};
  spec.bMin = intOr(b.min, v2 ? 10 : 25); spec.bMax = intOr(b.max, defMax);
  const tv = funcs[spec.temp] || {};
  spec.tMin = intOr(tv.min, 0); spec.tMax = intOr(tv.max, defMax);
  const c = funcs[spec.colour] || {};
  spec.sMax = intOr(c.s?.max, defMax);
  spec.vMin = intOr(c.v?.min, 0);
  spec.vMax = intOr(c.v?.max, defMax);
  if (spec.bMax <= spec.bMin) [spec.bMin, spec.bMax] = v2 ? [10, 1000] : [25, 255];
  if (spec.tMax <= spec.tMin) [spec.tMin, spec.tMax] = [0, defMax];
  if (spec.sMax <= 0) spec.sMax = defMax;
  if (spec.vMax <= 0) spec.vMax = defMax;
  cache.spec = spec; cache.specAt = Date.now();
  return spec;
}

const toPct = (raw, lo, hi, floor = 0) =>
  Math.trunc(clamp(Math.round((Number(raw) - lo) * (100 - floor) / (hi - lo)) + floor, floor, 100));
const fromPct = (pct, lo, hi, floor = 0) =>
  Math.round(lo + (hi - lo) * (clamp(pct, floor, 100) - floor) / (100 - floor));

function stateFromStatus(status, spec) {
  const s = {};
  for (const item of status || []) if (item && typeof item === 'object') s[item.code] = item.value;
  const mode = spec.mode ? s[spec.mode] : (spec.colour in s && !spec.bright ? 'colour' : 'white');
  const st = {
    on: Boolean(s[spec.switch]),
    mode: mode === 'colour' ? 'colour' : (mode === undefined || mode === null || mode === 'white') ? 'white' : String(mode),
  };
  if (spec.bright in s) st.brightness = toPct(s[spec.bright], spec.bMin, spec.bMax, 1);
  if (spec.temp in s) st.temp = toPct(s[spec.temp], spec.tMin, spec.tMax);
  const col = parseJson(s[spec.colour]);
  if (spec.colour in s && Object.keys(col).length) {
    st.h = Math.trunc(Number(col.h) || 0) % 360;
    st.s = Math.trunc(clamp(Math.round((Number(col.s) || 0) * 100 / spec.sMax), 0, 100));
    st.v = Math.trunc(clamp(Math.round((Number(col.v) || 0) * 100 / spec.vMax), 1, 100));
  }
  let effect = null;
  if (st.mode === 'scene' && spec.scene) {
    const n = parseJson(s[spec.scene]).scene_num;
    if (Number.isInteger(n) && n >= 1 && n <= EFFECTS.length) effect = EFFECTS[n - 1];
  }
  const remaining = spec.countdown ? Number(s[spec.countdown]) || 0 : 0;
  return { state: st, effect, remaining: Math.trunc(remaining) };
}

async function send(did, commands) {
  await tuya().call('POST', `/v1.0/iot-03/devices/${did}/commands`, undefined, { commands });
}

// ----- commands for each kind of light setting

const cmdPower = (spec, on) => [{ code: spec.switch, value: Boolean(on) }];

function cmdColour(spec, h, s, v) {
  if (!spec.colour) throw new BadRequest('This bulb has no colour support.');
  const cmds = cmdPower(spec, true);
  if (spec.mode) cmds.push({ code: spec.mode, value: 'colour' });
  const value = {
    h: ((Math.round(h) % 360) + 360) % 360,
    s: Math.round(clamp(s, 0, 100) * spec.sMax / 100),
    v: Math.max(spec.vMin, 1, Math.round(clamp(v, 1, 100) * spec.vMax / 100)),
  };
  cmds.push({ code: spec.colour, value: JSON.stringify(value) });
  return cmds;
}

function cmdWhite(spec, brightness, temp) {
  const cmds = cmdPower(spec, true);
  if (spec.mode) cmds.push({ code: spec.mode, value: 'white' });
  if (spec.bright) cmds.push({ code: spec.bright, value: fromPct(brightness, spec.bMin, spec.bMax, 1) });
  if (spec.temp) cmds.push({ code: spec.temp, value: fromPct(temp, spec.tMin, spec.tMax) });
  return cmds;
}

function cmdLight(spec, light) {
  if (light.mode === 'colour') return cmdColour(spec, light.h, light.s, light.v);
  return cmdWhite(spec, light.brightness ?? 100, light.temp ?? 30);
}

// a scene the bulb animates by itself, so it needs no stream of API calls
function sceneData(name, speed, baseH, baseS) {
  const dur = Math.trunc(clamp(Math.round(100 - speed * 0.9), 10, 100));
  const sat = Math.trunc(clamp(baseS, 40, 100) * 10);
  const unit = (mode, h, s = 1000, v = 1000, d = dur) => ({
    unit_change_mode: mode, unit_switch_duration: d, unit_gradient_duration: d,
    bright: 0, temperature: 0, h: ((Math.trunc(h) % 360) + 360) % 360, s: Math.trunc(s), v: Math.trunc(v),
  });
  let units;
  if (name === 'rainbow') units = [0, 60, 120, 180, 240, 300].map(h => unit('gradient', h));
  else if (name === 'breathe') units = [unit('gradient', baseH, sat, 1000), unit('gradient', baseH, sat, 60)];
  else if (name === 'candle') {
    const fast = Math.min(dur, 25);
    units = [[26, 1000, 1000], [20, 1000, 550], [30, 950, 850], [22, 1000, 420], [28, 1000, 750]].map(([h, s, v]) => unit('gradient', h, s, v, fast));
  } else if (name === 'party') units = [0, 30, 55, 120, 180, 220, 275, 310].map(h => unit('jump', h));
  else if (name === 'ocean') units = [[195, 900, 650], [215, 1000, 1000], [185, 850, 450], [205, 950, 900]].map(([h, s, v]) => unit('gradient', h, s, v));
  else if (name === 'aurora') units = [[140, 850, 900], [170, 800, 650], [260, 850, 900], [290, 800, 650]].map(([h, s, v]) => unit('gradient', h, s, v));
  else throw new BadRequest(`Unknown effect '${name}'`);
  return { scene_num: EFFECTS.indexOf(name) + 1, scene_units: units };
}

// Bulbs disagree on how they want scene data, so try a few shapes and keep the one that works.
const SCENE_SHAPES = [
  (spec, data) => [...cmdPower(spec, true), ...(spec.mode ? [{ code: spec.mode, value: 'scene' }] : []), { code: spec.scene, value: JSON.stringify(data) }],
  (spec, data) => [...cmdPower(spec, true), { code: spec.scene, value: data }, ...(spec.mode ? [{ code: spec.mode, value: 'scene' }] : [])],
  (spec, data) => [{ code: spec.scene, value: JSON.stringify(data) }],
];

function sceneApplied(status, spec, data) {
  const s = {};
  for (const item of status || []) if (item && typeof item === 'object') s[item.code] = item.value;
  if (spec.mode && s[spec.mode] !== 'scene') return false;
  const units = parseJson(s[spec.scene]).scene_units;
  if (!Array.isArray(units)) return true;  // reported in a format we can't read: trust the mode
  return units.length === data.scene_units.length && Number(units[0]?.h) === data.scene_units[0].h;
}

async function startBulbEffect(did, spec, data) {
  if (!spec.scene) return { ok: false, reason: 'Your bulb has no built-in effects.' };
  const all = SCENE_SHAPES.map((_, i) => i);
  const order = cache.sceneShape === null ? all : [cache.sceneShape, ...all.filter(i => i !== cache.sceneShape)];
  let reason = "Your bulb didn't switch to the effect.";
  for (const i of order) {
    try {
      await send(did, SCENE_SHAPES[i](spec, data));
    } catch (e) {
      // offline or trial expired: retrying another shape won't help
      if (!(e instanceof TuyaError) || e.code === 2001 || e.code === 28841002) throw e;
      reason = e.message;
      continue;
    }
    await sleep(1500);  // give the bulb time to report back to the cloud
    let status;
    try {
      status = await readStatus(did);
    } catch (e) {
      if (!(e instanceof TuyaError)) throw e;
      // can't confirm it worked: let the page animate the effect instead of failing
      return { ok: false, reason: "Couldn't check the bulb's state. " + e.message };
    }
    if (sceneApplied(status, spec, data)) {
      cache.sceneShape = i;
      return { ok: true };
    }
  }
  cache.sceneShape = null;
  return { ok: false, reason };
}

// ---------------------------------------------------------------- schedules (Tuya cloud timers)

// Tuya's 7-character loops string starts on Sunday; our days are Monday=0 .. Sunday=6
function daysToLoops(days) {
  const bits = Array(7).fill('0');
  for (const d of days) bits[(d + 1) % 7] = '1';
  return bits.join('');
}
function loopsToDays(loops) {
  return [...String(loops || '0000000').slice(0, 7)]
    .map((c, i) => (c === '1' ? (i + 6) % 7 : null)).filter(d => d !== null).sort((a, b) => a - b);
}
const toMinutes = hhmm => { const [h, m] = hhmm.split(':'); return Number(h) * 60 + Number(m); };
const toHHMM = minutes => `${pad(Math.trunc(minutes / 60))}:${pad(minutes % 60)}`;

// Tuya's timer listing nests categories and groups; walk it tolerantly
function* iterGroups(node, category = null) {
  if (Array.isArray(node)) {
    for (const item of node) yield* iterGroups(item, category);
  } else if (node && typeof node === 'object') {
    let cat = node.category;
    if (cat && typeof cat === 'object') cat = cat.category;
    cat = cat || category;
    if ('groups' in node) for (const g of node.groups || []) yield [cat, g];
    else if ('timers' in node && 'id' in node) yield [cat, node];
  }
}

function timerList(group) {
  let timers = group.timers || [];
  if (!Array.isArray(timers)) timers = Object.values(timers);
  return timers.filter(t => t && typeof t === 'object' && t.time).sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
}

function scheduleFromGroup(group, spec) {
  const timers = timerList(group);
  if (!timers.length) return null;
  const firstT = timers[0], lastT = timers[timers.length - 1];
  const funcs = {};
  for (const f of lastT.functions || []) if (f && typeof f === 'object') funcs[f.code] = f.value;
  const action = funcs[spec.switch] === false ? 'off' : 'on';
  let light = null;
  if (action === 'on') {
    const mode = spec.mode ? funcs[spec.mode] : null;
    if (mode === 'colour' || (!spec.mode && spec.colour in funcs)) {
      const col = parseJson(funcs[spec.colour]);
      if (Object.keys(col).length) {
        light = {
          mode: 'colour', h: Math.trunc(Number(col.h) || 0) % 360,
          s: Math.round((Number(col.s) || 0) * 100 / spec.sMax),
          v: Math.trunc(clamp(Math.round((Number(col.v) || 0) * 100 / spec.vMax), 1, 100)),
        };
      }
    } else if (spec.bright in funcs) {
      light = {
        mode: 'white',
        brightness: toPct(funcs[spec.bright], spec.bMin, spec.bMax, 1),
        temp: toPct(funcs[spec.temp] ?? spec.tMin, spec.tMin, spec.tMax),
      };
    }
  }
  const date = String(firstT.date || '');
  return {
    id: String(group.id || firstT.group_id || ''),
    name: firstT.alias_name || '',
    time: firstT.time,
    action,
    light,
    fade: timers.length > 1 ? toMinutes(lastT.time) - toMinutes(firstT.time) : 0,
    days: loopsToDays(firstT.loops),
    date: date.length === 8 ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : '',
    enabled: String(firstT.status ?? 1) === '1',
    functions: lastT.functions || [],
  };
}

async function listSchedules(did, spec) {
  const result = await tuya().call('GET', `/v1.0/devices/${did}/timers`);
  const items = [];
  for (const [cat, group] of iterGroups(result)) {
    if (cat && cat !== SCHEDULE_CATEGORY) continue;  // leave Smart Life's own schedules alone
    const item = scheduleFromGroup(group, spec);
    if (item) items.push(item);
  }
  return items.sort((a, b) => a.time.localeCompare(b.time));
}

function buildTimer(body, spec) {
  const t = String(body.time ?? '');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new BadRequest('Time must look like 07:30');
  const action = body.action ?? 'on';
  if (action !== 'on' && action !== 'off') throw new BadRequest('Action must be on or off');
  const days = [...new Set((body.days || []).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
  let light = action === 'on' ? (body.light ?? null) : null;
  if (light) {
    light = light.mode === 'colour'
      ? { mode: 'colour', h: num(light, 'h', 0, 360), s: num(light, 's', 0, 100), v: num(light, 'v', 1, 100) }
      : { mode: 'white', brightness: num(light, 'brightness', 1, 100, 100), temp: num(light, 'temp', 0, 100, 30) };
  }
  const start = toMinutes(t);
  let fade = action === 'on' ? Math.trunc(clamp(Number(body.fade) || 0, 0, 60)) : 0;
  fade = Math.min(fade, 23 * 60 + 59 - start);  // keep the whole fade on the same day

  let steps;
  if (action === 'off') steps = [[start, cmdPower(spec, false)]];
  else if (fade <= 0) steps = [[start, light ? cmdLight(spec, light) : cmdPower(spec, true)]];
  else {
    const target = light || { mode: 'white', brightness: 100, temp: 30 };
    const key = target.mode === 'colour' ? 'v' : 'brightness';
    const count = Math.trunc(clamp(Math.trunc(fade / 2) + 1, 2, 6));
    const seen = new Set();
    steps = [];
    for (let i = 0; i < count; i++) {
      const minute = start + Math.round(fade * i / (count - 1));
      if (seen.has(minute)) continue;
      seen.add(minute);
      const level = Math.max(1, Math.round(target[key] * (i + 1) / count));
      steps.push([minute, cmdLight(spec, { ...target, [key]: level })]);
    }
  }

  let date = '';
  if (!days.length) {  // one-time: Tuya needs a date in the future
    const now = localNow();
    const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
    const day = start > nowMin ? now : new Date(now.getTime() + 86400000);
    date = `${day.getUTCFullYear()}${pad(day.getUTCMonth() + 1)}${pad(day.getUTCDate())}`;
  }
  return {
    category: SCHEDULE_CATEGORY,
    loops: daysToLoops(days),
    time_zone: env('TZ_OFFSET', '+05:30'),
    timezone_id: env('TIMEZONE', 'Asia/Kolkata'),
    alias_name: String(body.name || '').slice(0, 40) || `Turn ${action}`,
    instruct: steps.map(([m, f]) => ({ time: toHHMM(m), functions: f, ...(date ? { date } : {}) })),
  };
}

const timerPath = (did, gid) => gid === undefined
  ? `/v1.0/devices/${did}/timers`
  : `/v1.0/devices/${did}/timers/categories/${SCHEDULE_CATEGORY}/groups/${encodeURIComponent(String(gid))}`;

async function setScheduleEnabled(did, gid, enabled) {
  await tuya().call('PUT', timerPath(did, gid) + '/status', undefined, { value: enabled ? '1' : '0' });
}

async function saveSchedule(did, spec, body) {
  const timer = buildTimer(body, spec);
  if (body.id) await tuya().call('DELETE', timerPath(did, body.id));
  const result = (await tuya().call('POST', timerPath(did), undefined, timer)) || {};
  const gid = typeof result === 'object' ? result.group_id : null;
  if (gid && body.enabled === false) await setScheduleEnabled(did, gid, false);
  return gid;
}

// ---------------------------------------------------------------- login

const authRequired = () => env('APP_PASSWORD') !== '';

function sessionKey() {
  const password = env('APP_PASSWORD');
  if (password.length < 8) {
    throw new ConfigError('APP_PASSWORD must be 8 or more characters. To turn the password off, delete APP_PASSWORD in Lambda -> Configuration -> Environment variables.');
  }
  // changing the password (or the Tuya secret) signs everyone out
  return createHash('sha256').update(`halonix-web|${password}|${env('TUYA_ACCESS_SECRET')}`, 'utf8').digest();
}

function makeSession() {
  const expires = String(Math.trunc(Date.now() / 1000) + SESSION_DAYS * 86400);
  return `${expires}.${hmacHex(sessionKey(), expires)}`;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a), 'utf8'), y = Buffer.from(String(b), 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

function sessionOk(token) {
  const dot = String(token || '').indexOf('.');
  if (dot < 1) return false;
  const expires = token.slice(0, dot), sig = token.slice(dot + 1);
  if (!/^\d+$/.test(expires) || Number(expires) < Date.now() / 1000) return false;
  return safeEqual(sig, hmacHex(sessionKey(), expires));
}

// ---------------------------------------------------------------- HTTP

let pageHtml = null;

function respond(statusCode, body, contentType = 'application/json') {
  return {
    statusCode,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

async function snapshot() {
  const did = await deviceId();
  const spec = await lightSpec(did);
  const info = (await tuya().call('GET', `/v1.0/devices/${did}`)) || {};
  const status = info.status || await readStatusV2(did);
  const { state, effect, remaining } = stateFromStatus(status, spec);
  const online = info.online === undefined ? true : Boolean(info.online);
  return {
    configured: true,
    demo: false,
    cloud: true,
    auth: authRequired(),
    connected: online,
    error: online ? null : "Your bulb is offline in Tuya's cloud. Check it is switched on at the wall and your Wi-Fi works.",
    device: { name: info.name || 'Halonix bulb', id: did, product: info.product_name || '' },
    caps: { colour: !!spec.colour, colourtemp: !!spec.temp, timer: !!spec.countdown, scene: !!spec.scene, music: !!spec.colour },
    state,
    effect,
    timer_until: remaining && state.on ? Date.now() / 1000 + remaining : null,
    music_method: 'standard',
  };
}

async function route(method, path, body) {
  if (method === 'GET' && path === '/api/state') return snapshot();
  if (method === 'GET' && path === '/api/devices') {
    const devices = await listDevices();
    return {
      devices: devices.map(d => ({ id: d.id, name: d.name, product: d.product_name || '', online: d.online, is_light: LIGHT_CATEGORIES.has(d.category) })),
      current: await deviceId(),
      pinned: !!env('DEVICE_ID'),
    };
  }

  const did = await deviceId();
  const spec = await lightSpec(did);

  if (method === 'GET' && path === '/api/schedules') {
    const now = localNow();
    return { schedules: await listSchedules(did, spec), now: `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}` };
  }
  if (method === 'POST' && path === '/api/power') {
    await send(did, cmdPower(spec, !!body.on));
    return { ok: true };
  }
  if (method === 'POST' && (path === '/api/colour' || path === '/api/music/frame')) {
    await send(did, cmdColour(spec, num(body, 'h', 0, 360), num(body, 's', 0, 100), num(body, 'v', 1, 100)));
    return { ok: true };
  }
  if (method === 'POST' && path === '/api/white') {
    await send(did, cmdWhite(spec, num(body, 'brightness', 1, 100), num(body, 'temp', 0, 100)));
    return { ok: true };
  }
  if (method === 'POST' && path === '/api/effect') {
    if (!EFFECTS.includes(body.name)) throw new BadRequest('Unknown effect');
    // the page remembers which shape worked, so a cold start doesn't have to search again
    if (cache.sceneShape === null && Number.isInteger(body.shape) && body.shape >= 0 && body.shape < SCENE_SHAPES.length) {
      cache.sceneShape = body.shape;
    }
    const data = sceneData(body.name, num(body, 'speed', 0, 100, 50), num(body, 'h', 0, 360, 30), num(body, 's', 0, 100, 100));
    const result = await startBulbEffect(did, spec, data);
    // ok:false tells the page to animate the effect itself instead
    return result.ok ? { ok: true, effect: body.name, shape: cache.sceneShape } : { ok: false, fallback: true, reason: result.reason };
  }
  if (method === 'GET' && path === '/api/debug') {
    // what the bulb supports, for troubleshooting. Device info also holds the bulb's
    // local key, so only status/online are copied out of it.
    const probe = async path => { try { return await tuya().call('GET', path); } catch (e) { return { error: e.message }; } };
    const info = await probe(`/v1.0/devices/${did}`);
    return {
      device: did, spec, scene_shape: cache.sceneShape,
      functions: await probe(`/v1.0/iot-03/devices/${did}/functions`),
      online: info.online, status: info.error ? info : info.status,
      status_v2: await probe(`/v1.0/iot-03/devices/${did}/status`),
    };
  }
  if (method === 'POST' && path === '/api/timer') {
    if (!spec.countdown) throw new BadRequest('This bulb has no built-in timer.');
    const secs = Math.trunc(num(body, 'minutes', 0, 24 * 60) * 60);
    await send(did, [{ code: spec.countdown, value: secs }]);
    return { ok: true, timer_until: secs ? Date.now() / 1000 + secs : null };
  }
  if (method === 'POST' && path === '/api/schedules') {
    const id = await saveSchedule(did, spec, body);
    return { ok: true, id, schedules: await listSchedules(did, spec) };
  }

  const m = /^\/api\/schedules\/([^/]+)(\/enable|\/run)?$/.exec(path);
  if (m) {
    const gid = decodeURIComponent(m[1]), action = m[2];
    if (method === 'DELETE' && !action) {
      await tuya().call('DELETE', timerPath(did, gid));
      return { ok: true, schedules: await listSchedules(did, spec) };
    }
    if (method === 'POST' && action === '/enable') {
      await setScheduleEnabled(did, gid, !!body.enabled);
      return { ok: true, schedules: await listSchedules(did, spec) };
    }
    if (method === 'POST' && action === '/run') {
      const item = (await listSchedules(did, spec)).find(s => s.id === gid);
      if (!item) throw new BadRequest('Schedule not found');
      await send(did, item.functions);
      return { ok: true };
    }
  }
  return null;
}

export const handler = async (event) => {
  const method = event?.requestContext?.http?.method || event?.httpMethod || 'GET';
  const path = event?.rawPath || event?.path || '/';
  const headers = {};
  for (const [k, v] of Object.entries(event?.headers || {})) headers[k.toLowerCase()] = v;

  if (method === 'GET' && (path === '/' || path === '/index.html')) {
    if (!pageHtml) pageHtml = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
    return respond(200, pageHtml, 'text/html; charset=utf-8');
  }
  if (path === '/favicon.ico') return { statusCode: 204, headers: {}, body: '' };
  if (!path.startsWith('/api/')) return respond(404, { error: 'Not found' });

  let raw = event?.body || '';
  if (raw && event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  let body;
  try {
    body = raw ? JSON.parse(raw) : {};
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
  } catch (_) {
    return respond(400, { error: 'Bad JSON' });
  }

  try {
    if (path === '/api/login' && method === 'POST') {
      if (!authRequired()) return respond(200, { token: '', open: true });
      sessionKey();  // throws if APP_PASSWORD is too short
      if (!safeEqual(String(body.password ?? ''), env('APP_PASSWORD'))) {
        await sleep(1500);  // slow down guessing
        return respond(401, { error: 'Wrong password' });
      }
      return respond(200, { token: makeSession() });
    }

    const auth = headers.authorization || '';
    if (authRequired() && (!auth.startsWith('Bearer ') || !sessionOk(auth.slice(7)))) {
      return respond(401, { error: 'Please sign in', login: true });
    }
    if ((method === 'POST' || method === 'PUT') && !(headers['content-type'] || '').includes('application/json')) {
      return respond(415, { error: 'Send JSON' });
    }

    const result = await route(method, path, body);
    return result === null ? respond(404, { error: 'Not found' }) : respond(200, result);
  } catch (e) {
    if (e instanceof ConfigError) return respond(500, { error: e.message, config: true });
    if (e instanceof TuyaError) return respond(502, { error: e.message });
    if (e instanceof BadRequest) return respond(400, { error: e.message || 'Bad request' });
    console.error('Unexpected error:', e);  // keep the page usable and log the details
    return respond(500, { error: `Unexpected error: ${e.message}` });
  }
};
