/*
 * Buderus Heat Card – kombiniertes Anlagenschema (Kessel, Heizkreis, Speicher, Solarthermie)
 * Reine Anzeige-Karte: Antippen öffnet nur das More-Info-Fenster, es werden keine Dienste aufgerufen.
 */
const BHC_VERSION = "0.2.0";

const BHC_DEFAULT_ENTITIES = {
  outside: "",
  boiler_temp: "",
  burner: "",
  burner_power: "",
  flow: "",
  flow_target: "",
  heating_pump: "",
  heating_pump_mod: "",
  dhw_charging: "",
  charge_pump: "",
  tank_top: "",
  tank_bottom: "",
  dhw_target: "",
  collector: "",
  solar_pump: "",
  solar_pump_mod: "",
  mode: "",
  heater: "",
  heater_power: "",
};

const BHC_MODE_LABELS = { day: "Tag", night: "Nacht", nofrost: "Frostschutz", eco: "Eco", comfort: "Komfort" };

function bhcEsc(v) {
  return `${v ?? ""}`.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

class BuderusHeatCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._lastKey = null;
  }

  static getStubConfig() {
    return { title: "Heizungsanlage", entities: { ...BHC_DEFAULT_ENTITIES } };
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("Ungültige Konfiguration");
    this._config = {
      title: config.title ?? "Heizungsanlage",
      animation: config.animation !== false,
      labels: config.labels || {},
      solar: config.solar,
      heater_location: config.heater_location === "boiler" ? "boiler" : "tank",
      entities: { ...BHC_DEFAULT_ENTITIES, ...(config.entities || {}) },
    };
    this._lastKey = null;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 7;
  }

  getGridOptions() {
    return { columns: "full", min_columns: 6 };
  }

  /* ---------- helpers ---------- */
  _st(key) {
    const id = this._config.entities[key];
    return id && this._hass ? this._hass.states[id] : undefined;
  }
  _num(key) {
    const st = this._st(key);
    const n = st ? Number(st.state) : NaN;
    return Number.isFinite(n) ? n : null;
  }
  _on(key) {
    const st = this._st(key);
    if (!st) return false;
    const s = `${st.state}`.toLowerCase();
    if (["on", "true", "active", "heat", "running"].includes(s)) return true;
    const n = Number(s);
    return Number.isFinite(n) && n > 0;
  }
  _temp(key, digits = 1) {
    const n = this._num(key);
    return n === null ? "–" : `${n.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits })} °C`;
  }
  _pct(key) {
    const n = this._num(key);
    return n === null ? "" : `${Math.round(n)} %`;
  }
  _label(key, fallback) {
    return this._config.labels[key] || fallback;
  }
  _color(t) {
    if (t === null) return "#94a3b8";
    if (t < 20) return "#3b82f6";
    if (t < 35) return "#22c55e";
    if (t < 45) return "#eab308";
    if (t < 55) return "#f97316";
    return "#ef4444";
  }

  _hasSolar() {
    if (this._config.solar === false) return false;
    if (this._config.solar === true) return true;
    const e = this._config.entities;
    return Boolean(e.collector || e.solar_pump || e.solar_pump_mod);
  }
  _hasHeater() {
    const e = this._config.entities;
    return Boolean(e.heater || e.heater_power);
  }
  _heaterOn() {
    if (this._config.entities.heater) return this._on("heater");
    const p = this._num("heater_power");
    return p !== null && p > 5;
  }
  _power(key) {
    const st = this._st(key);
    const n = this._num(key);
    if (n === null) return "";
    const unit = st && st.attributes && st.attributes.unit_of_measurement ? st.attributes.unit_of_measurement : "W";
    if (unit === "W" && Math.abs(n) >= 1000) return `${(n / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} kW`;
    return `${Math.round(n).toLocaleString("de-DE")} ${unit}`;
  }

  _heaterSvg(on) {
    const e = this._config.entities;
    const id = e.heater || e.heater_power;
    const atBoiler = this._config.heater_location === "boiler";
    const x1 = atBoiler ? 82 : 434;
    const x2 = atBoiler ? 170 : 512;
    const y = atBoiler ? 464 : 362;
    const color = on ? "#f97316" : "var(--bhc-off)";
    return `<g class="click" data-entity="${bhcEsc(id)}">
      <rect x="${x1 - 6}" y="${y - 9}" width="12" height="18" rx="3" fill="var(--bhc-stroke)"/>
      <path d="M ${x1} ${y} H ${x2}" stroke="${color}" stroke-width="8" stroke-linecap="round" class="${on ? "heater-on" : ""}"/>
      <path d="M ${x1 + 14} ${y - 5} l 8 10 l 8 -10 l 8 10 l 8 -10 l 8 10" fill="none" stroke="${on ? "#fde68a" : "var(--bhc-muted)"}" stroke-width="2" stroke-linejoin="round" opacity="${on ? 1 : 0.5}"/>
    </g>`;
  }

  _stateKey() {
    if (!this._hass) return "nohass";
    return Object.values(this._config.entities)
      .map((id) => (id && this._hass.states[id] ? this._hass.states[id].state : "-"))
      .join("|");
  }

  /* ---------- svg parts ---------- */
  _pill(x, y, key, label, value, opts = {}) {
    const id = this._config.entities[key];
    if (!id) return "";
    const w = opts.w || 128;
    const color = opts.color || "var(--bhc-text)";
    return `<g class="click" data-entity="${bhcEsc(id)}" transform="translate(${x - w / 2},${y - 24})">
      <rect width="${w}" height="48" rx="12" class="pill ${opts.active ? "pill-active" : ""}"/>
      <text x="${w / 2}" y="18" class="pill-label">${bhcEsc(label)}</text>
      <text x="${w / 2}" y="38" class="pill-value" style="fill:${color}">${bhcEsc(value)}</text>
    </g>`;
  }

  _pipe(d, hot, active) {
    const anim = active && this._config.animation ? " flow" : "";
    return `<path d="${d}" class="pipe ${hot ? "hot" : "cold"} ${active ? "on" : "off"}${anim}"/>`;
  }

  _pump(cx, cy, key, active, dir = 0) {
    const id = this._config.entities[key];
    return `<g class="${id ? "click" : ""}" ${id ? `data-entity="${bhcEsc(id)}"` : ""} transform="translate(${cx},${cy})">
      <circle r="20" class="pump ${active ? "pump-on" : ""}"/>
      <g transform="rotate(${dir})"><path d="M -6 -11 L 11 0 L -6 11 Z" class="pump-arrow ${active ? "pump-arrow-on" : ""}"/></g>
    </g>`;
  }

  _svg() {
    const e = this._config.entities;
    const burner = this._on("burner");
    const heatPump = this._on("heating_pump");
    const chargeActive = this._on("charge_pump") || this._on("dhw_charging");
    const showSolar = this._hasSolar();
    const solarActive = showSolar && this._on("solar_pump");
    const showHeater = this._hasHeater();
    const heaterOn = showHeater && this._heaterOn();
    const atBoiler = this._config.heater_location === "boiler";
    const top = this._num("tank_top");
    const bottom = this._num("tank_bottom");
    const boilerT = this._num("boiler_temp");

    const flame = burner
      ? `<g class="flame-anim"><path d="M145 405c0-22 14-38 30-50 18 12 28 30 28 49 0 22-14 36-29 36s-29-14-29-35z" fill="#f97316"/>
         <path d="M163 398c0-11 7-21 14-27 10 7 15 17 15 27 0 13-8 21-15 21s-14-8-14-21z" fill="#fde68a"/></g>`
      : `<path d="M135 395h30" stroke="var(--bhc-muted)" stroke-width="4" stroke-linecap="round" opacity=".5"/>`;

    const modeSt = this._st("mode");
    const modeTxt = modeSt ? BHC_MODE_LABELS[modeSt.state] || modeSt.state : "";

    return `<svg viewBox="0 0 1000 645" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bhcTank" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${this._color(top)}" stop-opacity=".85"/>
          <stop offset="1" stop-color="${this._color(bottom)}" stop-opacity=".85"/>
        </linearGradient>
        <linearGradient id="bhcSolar" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#1e3a8a"/><stop offset="1" stop-color="#2563eb"/>
        </linearGradient>
        <linearGradient id="bhcMetal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="var(--bhc-metal1)"/><stop offset="1" stop-color="var(--bhc-metal2)"/>
        </linearGradient>
      </defs>

      <!-- Solarkreis: Kollektor -> Speicher unten (rechts) -->
      ${showSolar ? this._pipe("M 740 110 H 650 V 395 H 575", true, solarActive) : ""}
      ${showSolar ? this._pipe("M 575 445 H 700 V 150 H 760", false, solarActive) : ""}

      <!-- Ladekreis: Kessel -> Speicher oben (links) -->
      ${this._pipe("M 235 270 H 425", true, chargeActive)}
      ${this._pipe("M 425 330 H 235", false, chargeActive)}

      <!-- Heizkreis: Kessel -> Heizkörper -->
      ${this._pipe("M 235 400 H 320 V 540 H 760 V 400 H 790", true, heatPump)}
      ${this._pipe("M 950 470 H 970 V 575 H 290 V 440 H 235", false, heatPump)}

      <!-- Sonne + Kollektor -->
      ${showSolar ? `<g transform="translate(905,40)" class="${solarActive ? "sun-on" : "sun"}">
        <circle r="18" fill="#f59e0b"/>
        <g stroke="#f59e0b" stroke-width="4" stroke-linecap="round">
          <line y1="-28" y2="-40"/><line y1="28" y2="40"/><line x1="-28" x2="-40"/><line x1="28" x2="40"/>
          <line x1="-20" y1="-20" x2="-29" y2="-29"/><line x1="20" y1="20" x2="29" y2="29"/><line x1="-20" y1="20" x2="-29" y2="29"/><line x1="20" y1="-20" x2="29" y2="-29"/>
        </g>
      </g>
      <g class="${e.collector ? "click" : ""}" data-entity="${bhcEsc(e.collector)}">
        <polygon points="760,80 880,80 905,180 735,180" fill="url(#bhcSolar)" stroke="#475569" stroke-width="4" transform="translate(0,-10)"/>
        <g stroke="#8fb7ff" stroke-width="2.5" opacity=".85" transform="translate(0,-10)">
          <line x1="800" y1="82" x2="785" y2="178"/><line x1="840" y1="82" x2="835" y2="178"/>
          <line x1="752" y1="113" x2="888" y2="113"/><line x1="745" y1="146" x2="896" y2="146"/>
        </g>
      </g>` : ""}

      <!-- Speicher -->
      <g class="${e.tank_top ? "click" : ""}" data-entity="${bhcEsc(e.tank_top)}">
        <rect x="430" y="110" width="140" height="370" rx="70" fill="url(#bhcTank)" stroke="var(--bhc-stroke)" stroke-width="4"/>
        <path d="M 430 270 C 470 270 470 285 505 285 S 540 300 505 300 S 470 330 430 330" fill="none" stroke="${chargeActive ? "#ef4444" : "var(--bhc-off)"}" stroke-width="6" stroke-linecap="round"/>
        ${showSolar ? `<path d="M 570 395 C 530 395 530 410 495 410 S 460 425 495 425 S 530 445 570 445" fill="none" stroke="${solarActive ? "#f59e0b" : "var(--bhc-off)"}" stroke-width="6" stroke-linecap="round"/>` : ""}
      </g>
      ${showHeater && !atBoiler ? this._heaterSvg(heaterOn) : ""}

      <!-- Kessel -->
      <g class="${e.burner ? "click" : ""}" data-entity="${bhcEsc(e.burner)}">
        <rect x="65" y="230" width="170" height="250" rx="18" fill="url(#bhcMetal)" stroke="var(--bhc-stroke)" stroke-width="4"/>
        <rect x="88" y="252" width="124" height="54" rx="8" fill="#334155"/>
        <text x="150" y="286" class="display" style="fill:${this._color(boilerT)}">${bhcEsc(this._temp("boiler_temp"))}</text>
        <rect x="95" y="340" width="110" height="110" rx="12" fill="#1e293b"/>
        ${flame}
      </g>
      ${showHeater && atBoiler ? this._heaterSvg(heaterOn) : ""}

      <!-- Heizkörper -->
      <g class="${e.flow ? "click" : ""}" data-entity="${bhcEsc(e.flow)}">
        <rect x="790" y="360" width="160" height="130" rx="12" fill="url(#bhcMetal)" stroke="var(--bhc-stroke)" stroke-width="4"/>
        <g fill="${heatPump ? "#fecaca" : "var(--bhc-fin)"}" stroke="var(--bhc-stroke)" stroke-width="1.5">
          <rect x="808" y="378" width="16" height="94" rx="7"/><rect x="836" y="378" width="16" height="94" rx="7"/>
          <rect x="864" y="378" width="16" height="94" rx="7"/><rect x="892" y="378" width="16" height="94" rx="7"/>
          <rect x="920" y="378" width="16" height="94" rx="7"/>
        </g>
      </g>

      <!-- Pumpen -->
      ${this._pump(330, 270, "charge_pump", chargeActive, 0)}
      ${this._pump(620, 540, "heating_pump", heatPump, 0)}
      ${showSolar ? this._pump(700, 300, "solar_pump", solarActive, -90) : ""}

      <!-- Werte -->
      ${this._pill(110, 70, "outside", this._label("outside", "Außen"), this._temp("outside"), { color: this._color(this._num("outside")) })}
      ${this._pill(255, 70, "mode", this._label("mode", "Heizkreis"), modeTxt || "–", { w: 120 })}
      ${this._pill(150, 530, "burner_power", this._label("burner", "Brenner"), burner ? `an · ${this._pct("burner_power") || ""}` : "aus", { active: burner, color: burner ? "#ea580c" : "var(--bhc-muted)" })}
      ${this._pill(330, 205, "charge_pump", this._label("charge", "WW-Ladung"), chargeActive ? "aktiv" : "aus", { active: chargeActive, color: chargeActive ? "#16a34a" : "var(--bhc-muted)" })}
      ${this._pill(500, 62, "tank_top", this._label("tank_top", "Speicher oben"), this._temp("tank_top"), { w: 140, color: this._color(top) })}
      ${this._pill(500, 507, "tank_bottom", this._label("tank_bottom", "Speicher unten"), this._temp("tank_bottom"), { w: 140, color: this._color(bottom) })}
      ${showSolar ? this._pill(820, 215, "collector", this._label("collector", "Kollektor"), this._temp("collector"), { color: this._color(this._num("collector")) }) : ""}
      ${showSolar ? this._pill(790, 268, "solar_pump_mod", this._label("solar_pump", "Solarpumpe"), solarActive ? `an · ${this._pct("solar_pump_mod")}` : "aus", { w: 120, active: solarActive, color: solarActive ? "#16a34a" : "var(--bhc-muted)" }) : ""}
      ${this._pill(870, 330, "flow", this._label("flow", "Vorlauf"), `${this._temp("flow")}${this._num("flow_target") !== null ? ` / ${Math.round(this._num("flow_target"))}°` : ""}`, { w: 150, color: this._color(this._num("flow")) })}
      ${this._pill(620, 615, "heating_pump_mod", this._label("heating_pump", "Heizkreispumpe"), heatPump ? `an · ${this._pct("heating_pump_mod")}` : "aus", { w: 140, active: heatPump, color: heatPump ? "#16a34a" : "var(--bhc-muted)" })}
      ${showHeater ? this._pill(atBoiler ? 150 : 352, atBoiler ? 590 : 365, this._config.entities.heater ? "heater" : "heater_power", this._label("heater", "Heizstab"), heaterOn ? `an${this._power("heater_power") ? " · " + this._power("heater_power") : ""}` : "aus", { w: 128, active: heaterOn, color: heaterOn ? "#ea580c" : "var(--bhc-muted)" }) : ""}
    </svg>`;
  }

  _styles() {
    return `
      :host { display:block; }
      ha-card { overflow:hidden; padding:14px 16px 16px; box-sizing:border-box; }
      .head { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:6px; }
      .title { font-size:1.05rem; font-weight:700; color:var(--primary-text-color); }
      .badge { font-size:.75rem; font-weight:600; padding:3px 10px; border-radius:999px; background:var(--bhc-chip); color:var(--secondary-text-color); }
      .badge.on { background:rgba(249,115,22,.16); color:#ea580c; }
      svg { width:100%; height:auto; display:block; }
      .wrap {
        --bhc-text: var(--primary-text-color, #172033);
        --bhc-muted: var(--secondary-text-color, #64748b);
        --bhc-stroke: color-mix(in srgb, var(--primary-text-color, #172033) 30%, transparent);
        --bhc-off: color-mix(in srgb, var(--primary-text-color, #172033) 18%, transparent);
        --bhc-pill: color-mix(in srgb, var(--card-background-color, #fff) 92%, var(--primary-text-color, #000) 8%);
        --bhc-chip: color-mix(in srgb, var(--primary-text-color, #000) 8%, transparent);
        --bhc-metal1: color-mix(in srgb, var(--card-background-color, #fff) 80%, #ffffff 20%);
        --bhc-metal2: color-mix(in srgb, var(--card-background-color, #fff) 75%, #94a3b8 25%);
        --bhc-fin: color-mix(in srgb, var(--card-background-color, #fff) 70%, #94a3b8 30%);
      }
      .pipe { fill:none; stroke-width:9; stroke-linecap:round; stroke-linejoin:round; }
      .pipe.hot.on { stroke:#ef4444; }
      .pipe.cold.on { stroke:#3b82f6; }
      .pipe.off { stroke:var(--bhc-off); }
      .pipe.flow { stroke-dasharray:14 12; animation:bhcFlow 1.4s linear infinite; }
      @keyframes bhcFlow { to { stroke-dashoffset:-26; } }
      .pump { fill:var(--bhc-pill); stroke:var(--bhc-stroke); stroke-width:5; }
      .pump-on { stroke:#16a34a; }
      .pump-arrow { fill:var(--bhc-muted); }
      .pump-arrow-on { fill:#16a34a; }
      .pill { fill:var(--bhc-pill); stroke:var(--bhc-off); stroke-width:1.5; }
      .pill-active { stroke:#16a34a; }
      .pill-label { font:600 12px var(--paper-font-body1_-_font-family, Roboto, sans-serif); fill:var(--bhc-muted); text-anchor:middle; }
      .pill-value { font:800 16px var(--paper-font-body1_-_font-family, Roboto, sans-serif); text-anchor:middle; }
      .display { font:800 22px var(--paper-font-body1_-_font-family, Roboto, sans-serif); text-anchor:middle; }
      .click { cursor:pointer; }
      .click:hover { filter:brightness(1.08); }
      .flame-anim { transform-origin:175px 440px; animation:bhcFlame 1.2s ease-in-out infinite; }
      @keyframes bhcFlame { 0%,100% { transform:scale(1); } 50% { transform:scale(1.07,1.12); } }
      .sun { opacity:.35; }
      .heater-on { filter:drop-shadow(0 0 6px rgba(249,115,22,.8)); animation:bhcGlow 1.6s ease-in-out infinite; }
      @keyframes bhcGlow { 0%,100% { opacity:1; } 50% { opacity:.75; } }
      @media (prefers-reduced-motion: reduce) { .pipe.flow, .flame-anim, .heater-on { animation:none; } }
    `;
  }

  _render() {
    if (!this._config || !this.shadowRoot) return;
    const key = this._stateKey();
    if (key === this._lastKey) return;
    this._lastKey = key;

    const burner = this._on("burner");
    const title = this._config.title;
    this.shadowRoot.innerHTML = `<style>${this._styles()}</style>
      <ha-card><div class="wrap">
        ${title ? `<div class="head"><div class="title">${bhcEsc(title)}</div>
          <div class="badge ${burner ? "on" : ""}">${burner ? "Brenner läuft" : "Brenner aus"}</div></div>` : ""}
        ${this._svg()}
      </div></ha-card>`;

    if (!this._bound) {
      this._bound = true;
      this.shadowRoot.addEventListener("click", (ev) => {
        const target = ev.composedPath().find((n) => n && n.dataset && n.dataset.entity);
        if (!target || !target.dataset.entity) return;
        ev.stopPropagation();
        this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: target.dataset.entity }, bubbles: true, composed: true }));
      });
    }
  }
}

if (!customElements.get("buderus-heat-card")) customElements.define("buderus-heat-card", BuderusHeatCard);
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "buderus-heat-card")) {
  window.customCards.push({
    type: "buderus-heat-card",
    name: "Buderus Heat Card",
    description: "Kombiniertes Anlagenschema: Kessel, Heizkreis, Speicher und Solarthermie (nur Anzeige).",
  });
}
console.info(`%c BUDERUS-HEAT-CARD %c v${BHC_VERSION} `, "color:#fff;background:#ea580c;font-weight:700", "color:#ea580c;background:#fff;font-weight:700");
