"use strict";

/*
 * Outpost Zero
 * Educational habitat-management game.
 * IMPORTANT: rates and module values below are simplified game values,
 * not official NASA hardware specifications or mission design limits.
 */

const API_BASE = "https://outpost-moderator.ramneek-space.workers.dev";
const TURN_HOURS = 24;
const MISSION_LENGTH = 60;
const BASE_LOAD_KW = 4;
const MIN_BASE_POWER_FRACTION = 0.8;

const SITES = {
  moon: {
    name: "Moon",
    fullName: "Lunar South Pole scenario",
    solarKW: 8,
    basePanels: 5,
    baseDose: 1.36,
    flareDose: 25,
    sky: "#030712",
    ground: "#7e838f",
    description:
      "The lunar south polar region has complex lighting and long-lasting shadows. This game simplifies the local lighting into an eight-turn daylight / four-turn shadow cycle; it is not a real site timetable."
  },
  mars: {
    name: "Mars",
    fullName: "Jezero Crater scenario",
    solarKW: 3.5,
    basePanels: 12,
    sunlightFactor: 0.44,
    baseDose: 0.67,
    flareDose: 20,
    sky: "#a8542b",
    ground: "#7c351e",
    description:
      "Mars receives less sunlight than Earth, and dust can reduce solar output. The storm duration and power reduction in this game are simplified gameplay assumptions."
  }
};

const MODULES = {
  solar: {
    icon: "☀️", name: "Solar Array", cost: 30, max: 30,
    description: "+8 kW on the Moon / +3.5 kW on Mars in full sunlight."
  },
  battery: {
    icon: "🔋", name: "Battery Unit", cost: 25, max: 20,
    description: "+40 kWh energy storage capacity."
  },
  reactor: {
    icon: "⚛️", name: "Fission Power Unit", cost: 120, max: 3,
    description: "+24 kW steady game-scenario power, day and night."
  },
  oxygen: {
    icon: "💨", name: "Oxygen Production Unit", cost: 35, max: 5,
    description: "+1.7 kg O₂ per turn at full power; uses 4 kW. Not a MOXIE specification."
  },
  greenhouse: {
    icon: "🌱", name: "Greenhouse Module", cost: 40, max: 5,
    description: "+1.5 kg food per turn at full output; uses 3 kW."
  },
  lab: {
    icon: "🔬", name: "Science Laboratory", cost: 50, max: 4,
    description: "+3 science per turn at full power; uses 2 kW."
  },
  shield: {
    icon: "🛡️", name: "Regolith Shield Layer", cost: 45, max: 8,
    description: "Reduces remaining game radiation by 25% per layer. Simplified game rule."
  }
};

const $ = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const format1 = (value) => Number(value).toFixed(1);

let S = null;
let audioContext = null;
let soundEnabled = true;
let submittingScore = false;
let previousFocus = null;

/* ---------- Sound ---------- */
function playSound(type) {
  if (!soundEnabled) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    audioContext ??= new AudioContextClass();
    if (audioContext.state === "suspended") audioContext.resume();

    const now = audioContext.currentTime;
    const presets = {
      click: { wave: "sine", start: 420, end: 760, duration: 0.06, volume: 0.055 },
      buy: { wave: "triangle", start: 340, end: 720, duration: 0.22, volume: 0.075 },
      turn: { wave: "sine", start: 250, end: 520, duration: 0.16, volume: 0.065 },
      alert: { wave: "sawtooth", start: 360, end: 260, duration: 0.2, volume: 0.07 },
      win: { wave: "triangle", start: 520, end: 900, duration: 0.32, volume: 0.07 }
    };
    const preset = presets[type];
    if (!preset) return;

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = preset.wave;
    oscillator.frequency.setValueAtTime(preset.start, now);
    if (preset.start > 0 && preset.end > 0) {
      oscillator.frequency.exponentialRampToValueAtTime(preset.end, now + preset.duration);
    }
    gain.gain.setValueAtTime(preset.volume, now);
    gain.gain.linearRampToValueAtTime(0, now + preset.duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + preset.duration);
  } catch (error) {
    // Sound is optional. Audio failures must never stop the game.
    console.debug("Sound effect unavailable:", error);
  }
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  const button = $("btn_audio");
  button.textContent = soundEnabled ? "🔊 Sound on" : "🔇 Sound off";
  button.setAttribute("aria-pressed", String(soundEnabled));
  if (soundEnabled) playSound("click");
}

/* ---------- Small DOM helpers ---------- */
function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function setText(id, value) {
  $(id).textContent = String(value);
}

function addParagraph(parent, text, className = "") {
  const p = makeElement("p", className, text);
  parent.appendChild(p);
  return p;
}

/* ---------- Mission state ---------- */
function createMission(site) {
  const definition = SITES[site];
  if (!definition) throw new Error("Unknown destination.");

  S = {
    site,
    turn: 1,
    bp: 120,
    science: 0,
    batteryKWh: 160,
    oxygenKg: 30,
    foodKg: 40,
    radiationMsv: 0,
    starvationTurns: 0,
    coldTurns: 0,
    cropBlightTurns: 0,
    dustStormTurns: 0,
    flareNextTurn: false,
    over: false,
    won: false,
    log: [],
    modules: {
      solar: definition.basePanels,
      battery: 4,
      reactor: 0,
      oxygen: 2,
      greenhouse: 2,
      lab: 1,
      shield: 1
    }
  };

  $("s_o2").value = "100";
  $("s_gh").value = "100";
  $("s_lab").value = "50";
  $("shel").checked = false;
  ["s_o2", "s_gh", "s_lab", "shel", "go"].forEach((id) => { $(id).disabled = false; });

  addLog(`Welcome to ${definition.fullName}. Keep the crew supplied for ${MISSION_LENGTH} mission turns.`, "ok");
  closeModal(false);
  updateUI();
  playSound("click");
}

function addLog(message, type = "") {
  if (!S) return;
  S.log.unshift({ turn: S.turn, message, type });
  S.log = S.log.slice(0, 40);
  renderLog();
}

/* ---------- Lighting and power model ---------- */
function sunlightFactor() {
  if (S.site === "moon") {
    // Simplified game cycle only: 8 bright turns followed by 4 shadow turns.
    return ((S.turn - 1) % 12) < 8 ? 1 : 0;
  }
  const ordinarySunlight = SITES.mars.sunlightFactor;
  return S.dustStormTurns > 0 ? ordinarySunlight * 0.2 : ordinarySunlight;
}

function allocateEnergy(availableKWh, requestedKWh) {
  let remaining = availableKWh;
  let usedKWh = 0;
  const fractions = {};

  // Priority order: basic habitat systems, oxygen, food production, then research.
  for (const system of ["base", "oxygen", "greenhouse", "lab"]) {
    const requested = requestedKWh[system];
    const supplied = Math.min(remaining, requested);
    remaining -= supplied;
    usedKWh += supplied;
    fractions[system] = requested > 0 ? supplied / requested : 1;
  }

  return { fractions, usedKWh };
}

function calculatePlan() {
  const modules = S.modules;
  const shelter = $("shel").checked;
  const settings = {
    oxygen: Number($("s_o2").value) / 100,
    greenhouse: Number($("s_gh").value) / 100,
    lab: Number($("s_lab").value) / 100
  };
  const sun = sunlightFactor();
  const site = SITES[S.site];

  const solarKW = modules.solar * site.solarKW * sun;
  const reactorKW = modules.reactor * 24;
  const generationKW = solarKW + reactorKW;
  const generationKWh = generationKW * TURN_HOURS;

  const requestedKWh = {
    base: BASE_LOAD_KW * TURN_HOURS,
    oxygen: modules.oxygen * 4 * settings.oxygen * TURN_HOURS,
    greenhouse: modules.greenhouse * 3 * settings.greenhouse * TURN_HOURS,
    lab: (shelter ? 0 : modules.lab * 2 * settings.lab * TURN_HOURS)
  };

  const availableKWh = generationKWh + S.batteryKWh;
  const allocation = allocateEnergy(availableKWh, requestedKWh);
  const demandKWh = Object.values(requestedKWh).reduce((total, value) => total + value, 0);
  const batteryCapacityKWh = modules.battery * 40;

  const oxygenProducedKg = modules.oxygen * 1.7 * settings.oxygen * allocation.fractions.oxygen;
  const greenhouseHarvestKg =
    modules.greenhouse * 1.5 * settings.greenhouse * allocation.fractions.greenhouse *
    (shelter ? 0.5 : 1) * (S.cropBlightTurns > 0 ? 0.5 : 1);
  const scienceEarned = shelter
    ? 0
    : modules.lab * 3 * settings.lab * allocation.fractions.lab;

  return {
    shelter,
    settings,
    sun,
    solarKW,
    reactorKW,
    generationKW,
    generationKWh,
    requestedKWh,
    demandKWh,
    fractions: allocation.fractions,
    usedKWh: allocation.usedKWh,
    batteryCapacityKWh,
    oxygenProducedKg,
    greenhouseHarvestKg,
    scienceEarned
  };
}

/* ---------- Rendering ---------- */
function renderGauge(container, label, value, maximum, colorVariable, detail, rightText = "") {
  const row = makeElement("div", "g");
  row.appendChild(makeElement("span", "", label));

  const bar = makeElement("div", "bar");
  const fill = document.createElement("i");
  fill.style.width = `${clamp((value / Math.max(maximum, 1)) * 100, 0, 100)}%`;
  fill.style.background = `var(--${colorVariable})`;
  bar.appendChild(fill);
  row.appendChild(bar);

  const detailRow = makeElement("em");
  detailRow.appendChild(makeElement("span", "", detail));
  detailRow.appendChild(makeElement("span", "", rightText));
  row.appendChild(detailRow);
  container.appendChild(row);
}

function renderStats() {
  const stats = $("stats");
  stats.replaceChildren();
  const items = [
    ["Turn", `${S.turn} / ${MISSION_LENGTH}`],
    ["Build Points", `${Math.floor(S.bp)} BP`],
    ["Science", format1(S.science)]
  ];
  for (const [label, value] of items) {
    const span = makeElement("span");
    span.append(`${label} `, makeElement("b", "", value));
    stats.appendChild(span);
  }
}

function renderGauges(plan) {
  const container = $("gauges");
  container.replaceChildren();
  const modules = S.modules;
  renderGauge(container, "🔋 Battery", S.batteryKWh, plan.batteryCapacityKWh, "pw",
    `${Math.round(S.batteryKWh)} / ${plan.batteryCapacityKWh} kWh`,
    `${Math.round((S.batteryKWh / plan.batteryCapacityKWh) * 100)}%`);
  renderGauge(container, "💨 Oxygen", S.oxygenKg, 60, "o2",
    `${format1(S.oxygenKg)} / 60 kg`, `${Math.round((S.oxygenKg / 60) * 100)}%`);
  renderGauge(container, "🍎 Food", S.foodKg, 80, "fd",
    `${format1(S.foodKg)} / 80 kg`, `${Math.round((S.foodKg / 80) * 100)}%`);
  renderGauge(container, "☢️ Radiation", S.radiationMsv, 100, "rad",
    `${format1(S.radiationMsv)} / 100 mSv game limit`, S.radiationMsv >= 75 ? "HIGH" : "GAME LEVEL");
  const shieldReduction = (1 - Math.pow(0.75, modules.shield)) * 100;
  renderGauge(container, "🛡️ Shield", modules.shield, 8, "rad",
    `${modules.shield} / 8 layers`, `${Math.round(shieldReduction)}% game reduction`);
}

function renderForecast(plan) {
  const container = $("fc");
  container.replaceChildren();
  const netKW = plan.generationKW - plan.demandKWh / TURN_HOURS;
  const oxygenNet = plan.oxygenProducedKg - 3.4;
  const foodNet = plan.greenhouseHarvestKg - 3;

  const power = makeElement("p");
  power.append("⚡ Average power: ");
  power.appendChild(makeElement("b", "", `${format1(plan.generationKW)} kW generated`));
  power.append(` · ${format1(plan.demandKWh / TURN_HOURS)} kW requested`);
  power.append(" · ");
  power.appendChild(makeElement("b", netKW >= 0 ? "good" : "warn", `${netKW >= 0 ? "+" : ""}${format1(netKW)} kW before battery support`));
  container.appendChild(power);

  const energy = makeElement("p");
  energy.textContent = `🔋 Energy this turn: ${Math.round(plan.generationKWh)} kWh generated, ${Math.round(plan.usedKWh)} kWh allocated. Battery stores energy in kWh.`;
  container.appendChild(energy);

  if (plan.fractions.base < MIN_BASE_POWER_FRACTION) {
    addParagraph(container, "🚨 Critical: habitat baseline power is below the safe game target.", "warn");
  } else if (plan.fractions.oxygen < 0.99) {
    addParagraph(container, "⚠️ Oxygen production is being reduced by an energy shortage.", "warn");
  } else if (plan.fractions.greenhouse < 0.99) {
    addParagraph(container, "⚠️ Greenhouse lighting is being reduced by an energy shortage.", "warn");
  }

  const resourceRates = makeElement("p");
  resourceRates.textContent = `💨 Oxygen change: ${oxygenNet >= 0 ? "+" : ""}${format1(oxygenNet)} kg/turn · 🍎 Food change: ${foodNet >= 0 ? "+" : ""}${format1(foodNet)} kg/turn`;
  container.appendChild(resourceRates);

  let skyText;
  if (S.site === "moon") {
    const cyclePosition = (S.turn - 1) % 12;
    skyText = cyclePosition < 8
      ? `☀️ Simplified lunar scenario: ${8 - cyclePosition} daylight turn(s) before shadow.`
      : `🌑 Simplified shadow period: ${12 - cyclePosition} turn(s) remaining.`;
  } else {
    skyText = S.dustStormTurns > 0
      ? `🌪️ Dust storm scenario: solar output reduced for ${S.dustStormTurns} more turn(s).`
      : "☀️ Mars scenario: skies are clear.";
  }
  addParagraph(container, skyText);
  if (S.flareNextTurn) addParagraph(container, "☀️💥 Solar particle event forecast for the next turn. Consider the shelter.", "warn");
}

function renderScene() {
  const site = SITES[S.site];
  const sun = sunlightFactor();
  $("scene").style.background = `linear-gradient(${S.dustStormTurns > 0 ? "#542a17" : site.sky} 62%, ${site.ground} 62%)`;
  setText("earth", S.site === "moon" ? "🌍" : "");
  setText("sun", S.site === "moon" ? (sun > 0 ? "☀️" : "🌑") : (S.dustStormTurns > 0 ? "🌪️" : "☀️"));
  setText("sky_status", S.site === "moon" ? (sun > 0 ? "LUNAR DAY SCENARIO" : "LUNAR SHADOW SCENARIO") : (S.dustStormTurns > 0 ? "DUST STORM SCENARIO" : "CLEAR MARTIAN SKY"));

  const base = $("base");
  base.replaceChildren();
  const labels = [
    ["solar", "☀️", "Solar"], ["battery", "🔋", "Battery"], ["reactor", "⚛️", "Power"],
    ["oxygen", "💨", "Oxygen"], ["greenhouse", "🌱", "Greenhouse"],
    ["lab", "🔬", "Lab"], ["shield", "🛡️", "Shield"]
  ];
  for (const [key, icon, label] of labels) {
    if (S.modules[key] < 1) continue;
    const pod = makeElement("div", "base-pod");
    pod.title = label;
    pod.append(icon, makeElement("small", "", `×${S.modules[key]}`));
    base.appendChild(pod);
  }
}

function renderShop() {
  const shop = $("shop");
  shop.replaceChildren();
  for (const [key, item] of Object.entries(MODULES)) {
    const count = S.modules[key];
    const maximum = count >= item.max;
    const canBuy = !S.over && !maximum && S.bp >= item.cost;
    const button = makeElement("button");
    button.type = "button";
    button.disabled = !canBuy;
    button.dataset.module = key;

    const heading = makeElement("span");
    heading.append(`${item.icon} `, makeElement("b", "", `${item.name} ×${count}`));
    button.appendChild(heading);
    button.appendChild(makeElement("small", "", item.description));
    button.appendChild(makeElement("span", "cost", maximum ? "MAX LEVEL" : `${item.cost} BP`));
    shop.appendChild(button);
  }
}

function renderLog() {
  const log = $("log");
  if (!S) return;
  log.replaceChildren();
  for (const entry of S.log.slice(0, 20)) {
    const p = makeElement("p", `log-entry ${entry.type}`, `Turn ${entry.turn}: ${entry.message}`);
    log.appendChild(p);
  }
}

function updateUI() {
  if (!S) {
    // Keep mission controls inactive until a destination is selected.
    $("go").disabled = true;
    ["s_o2", "s_gh", "s_lab", "shel"].forEach((id) => { $(id).disabled = true; });
    $("stats").textContent = "Choose a destination to begin";
    $("gauges").textContent = "Mission resources will appear here.";
    $("fc").textContent = "Allocate energy carefully to protect life-support systems.";
    $("shop").textContent = "Choose Moon or Mars to unlock habitat upgrades.";
    $("log").textContent = "Mission log ready.";
    $("scene").style.background = "linear-gradient(#08172a 62%, #303c4d 62%)";
    $("sky_status").textContent = "AWAITING DESTINATION";
    return;
  }
  const plan = calculatePlan();
  renderStats();
  renderGauges(plan);
  renderForecast(plan);
  renderScene();
  renderShop();
  renderLog();

  for (const key of ["o2", "gh", "lab"]) {
    const slider = $(`s_${key}`);
    const label = $(`v_${key}`);
    const percent = Number(slider.value);
    label.textContent = `${percent}%`;
  }
  $("go").textContent = `Run Turn ${S.turn} ▶`;
}

/* ---------- Turn processing ---------- */
function checkFailure() {
  if (S.oxygenKg <= 0) return "oxygen";
  if (S.starvationTurns >= 4) return "food";
  if (S.radiationMsv >= 100) return "radiation";
  if (S.coldTurns >= 2) return "cold";
  return "";
}

function runTurn() {
  if (!S || S.over) return;
  playSound("turn");
  const plan = calculatePlan();
  const modules = S.modules;
  const shelterFactor = plan.shelter ? 0.5 : 1;

  // kWh = kW × hours. Battery capacity and energy use are therefore comparable.
  S.batteryKWh = clamp(
    S.batteryKWh + plan.generationKWh - plan.usedKWh,
    0,
    plan.batteryCapacityKWh
  );
  S.oxygenKg = clamp(S.oxygenKg + plan.oxygenProducedKg - 3.4, 0, 60);
  S.foodKg = clamp(S.foodKg + plan.greenhouseHarvestKg - 3, 0, 80);
  S.science += plan.scienceEarned;
  S.bp += 12 + Math.round(plan.scienceEarned * 3);

  const shieldFactor = Math.pow(0.75, modules.shield) * shelterFactor;
  let receivedDose = SITES[S.site].baseDose * shieldFactor;
  if (S.flareNextTurn) {
    receivedDose += SITES[S.site].flareDose * shieldFactor;
    addLog(`Solar particle event scenario: ${format1(SITES[S.site].flareDose * shieldFactor)} mSv added this turn.`, "bad");
    S.flareNextTurn = false;
    playSound("alert");
  }
  S.radiationMsv += receivedDose;

  if (plan.fractions.base < MIN_BASE_POWER_FRACTION) {
    S.coldTurns += 1;
    addLog("Habitat baseline power fell below the game's safe target. Thermal reserves are being depleted.", "bad");
  } else {
    S.coldTurns = 0;
  }

  if (S.foodKg <= 0) {
    S.starvationTurns += 1;
    addLog(`Food stores are empty (${S.starvationTurns}/4 consecutive turns).`, "bad");
    playSound("alert");
  } else {
    S.starvationTurns = Math.max(0, S.starvationTurns - 1);
  }

  if (S.dustStormTurns > 0) S.dustStormTurns -= 1;
  if (S.cropBlightTurns > 0) S.cropBlightTurns -= 1;

  const failure = checkFailure();
  if (failure) {
    finishMission(false, failure);
    return;
  }

  if (S.turn >= MISSION_LENGTH) {
    finishMission(true, "success");
    return;
  }

  S.turn += 1;
  if (Math.random() < 0.4) triggerEvent();

  if (checkFailure()) {
    finishMission(false, checkFailure());
    return;
  }
  updateUI();
}

function triggerEvent() {
  const roll = Math.random();
  const modules = S.modules;

  if (roll < 0.25 && !S.flareNextTurn) {
    S.flareNextTurn = true;
    addLog("Solar weather alert: a solar particle event is forecast for the next turn. Consider using the shelter.", "bad");
    playSound("alert");
    return;
  }

  if (roll < 0.45 && S.site === "mars" && S.dustStormTurns === 0) {
    S.dustStormTurns = 4;
    addLog("Dust storm scenario: solar-array output is reduced to 20% for the next four turns.", "bad");
    playSound("alert");
    return;
  }

  if (roll < 0.60) {
    const loss = Math.min(8, S.oxygenKg);
    S.oxygenKg = Math.max(0, S.oxygenKg - loss);
    addLog(`Habitat maintenance alert: a simulated air-system leak reduced stored oxygen by ${format1(loss)} kg.`, "bad");
    playSound("alert");
    return;
  }

  if (roll < 0.74 && S.cropBlightTurns === 0) {
    S.cropBlightTurns = 3;
    addLog("Greenhouse alert: a simulated crop-health problem halves harvest for three turns.", "bad");
    playSound("alert");
    return;
  }

  if (roll < 0.89) {
    const repairable = ["oxygen", "greenhouse", "solar", "lab"].filter((key) => modules[key] > 1);
    if (repairable.length > 0) {
      const selected = repairable[Math.floor(Math.random() * repairable.length)];
      modules[selected] -= 1;
      addLog(`Maintenance event: one ${MODULES[selected].name} module is offline. Rebuild it using BP.`, "bad");
      playSound("alert");
      return;
    }
  }

  S.bp += 50;
  addLog("Cargo resupply scenario: +50 Build Points added to the mission account.", "ok");
  playSound("buy");
}

/* ---------- Mission ending and score submission ---------- */
function calculateDisplayedScore(won) {
  return Math.round(
    S.science * 12 + S.turn * 10 + Math.max(0, 100 - S.radiationMsv) * 3 + (won ? 300 : 0)
  );
}

const DEBRIEFS = {
  oxygen: "Stored oxygen ran out. Real spacecraft use carefully designed life-support systems, monitoring and backup equipment.",
  food: "Food stores were empty for too many turns. A real mission needs carefully planned food reserves; a small greenhouse would only supplement the diet.",
  radiation: "The game radiation meter reached its fictional 100 mSv failure threshold. This is not a universal NASA mission limit.",
  cold: "The habitat did not receive enough baseline energy for two turns. Thermal control is an essential part of a spacecraft habitat.",
  success: "Mission complete! You maintained the habitat through all 60 turns in this game scenario."
};

function finishMission(won, reason) {
  if (S.over) return;
  S.over = true;
  S.won = won;
  ["s_o2", "s_gh", "s_lab", "shel", "go"].forEach((id) => { $(id).disabled = true; });
  updateUI();
  playSound(won ? "win" : "alert");
  showEndModal(won, reason);
}

function buildButton(text, className, onClick) {
  const button = makeElement("button", className, text);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}

function showEndModal(won, reason) {
  const content = document.createElement("div");
  const score = calculateDisplayedScore(won);
  addParagraph(content, `Final score estimate: ${score} points · Turn ${S.turn} · ${format1(S.science)} science · ${format1(S.radiationMsv)} mSv game meter.`);

  const debrief = makeElement("div", "tip");
  debrief.appendChild(makeElement("h3", "", "🛰️ Mission debrief"));
  addParagraph(debrief, DEBRIEFS[reason] || "Review your resource allocation and try another mission.");
  content.appendChild(debrief);

  const submitBox = makeElement("div", "submit-box");
  submitBox.appendChild(makeElement("h3", "", "🏆 Save to the shared leaderboard"));
  addParagraph(submitBox, "Choose a callsign, not your real name. Do not include your school, location, contact details or other personal information.");
  const inputLabel = makeElement("label", "", "Astronaut callsign (2–20 letters, numbers, _ or -)");
  inputLabel.htmlFor = "username_input";
  submitBox.appendChild(inputLabel);
  const inputRow = makeElement("div", "input-row");
  const input = makeElement("input");
  input.id = "username_input";
  input.type = "text";
  input.maxLength = 20;
  input.minLength = 2;
  input.autocomplete = "off";
  input.placeholder = "e.g. AstroCommander";
  input.spellcheck = false;
  input.setAttribute("aria-describedby", "callsign_help submit_status");
  const submit = buildButton("🚀 Save score", "btn-primary", () => submitScore(input, submit, status));
  submit.style.width = "auto";
  inputRow.append(input, submit);
  submitBox.appendChild(inputRow);
  const help = makeElement("p", "fine-print", "Only use a made-up callsign. The Worker checks callsigns before storing them.");
  help.id = "callsign_help";
  submitBox.appendChild(help);
  const status = makeElement("div", "status-msg");
  status.id = "submit_status";
  status.setAttribute("role", "status");
  submitBox.appendChild(status);
  content.appendChild(submitBox);

  const restartRow = makeElement("div", "card-row");
  restartRow.append(
    buildButton("🌕 New Moon mission", "pick", () => createMission("moon")),
    buildButton("🔴 New Mars mission", "pick", () => createMission("mars"))
  );
  content.appendChild(restartRow);

  openModal(won ? "🎉 Mission successful!" : `🚨 Mission ended on turn ${S.turn}`, content);
  input.focus();
}

async function submitScore(input, submitButton, status) {
  if (submittingScore || !S || !S.over) return;
  const callsign = input.value.trim();
  if (!/^[A-Za-z0-9_-]{2,20}$/.test(callsign)) {
    status.className = "status-msg err";
    status.textContent = "Use 2–20 characters: letters, numbers, underscores or hyphens only.";
    input.focus();
    return;
  }

  submittingScore = true;
  submitButton.disabled = true;
  input.disabled = true;
  status.className = "status-msg wait";
  status.textContent = "Checking the callsign and saving the mission record…";

  // Snapshot mission data before awaiting the network. A new mission cannot alter this record.
  const payload = {
    callsign,
    world: S.site === "moon" ? "Moon" : "Mars",
    turns: S.turn,
    science: Number(S.science.toFixed(2)),
    radiation: Number(S.radiationMsv.toFixed(2)),
    won: Boolean(S.won)
  };

  try {
    const response = await fetch(`${API_BASE}/api/scores`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Server returned ${response.status}.`);

    if (data.saved) {
      status.className = "status-msg succ";
      status.textContent = `✅ ${data.message || "Mission record saved."} Server-calculated score: ${data.score} points.`;
      submitButton.textContent = "Saved";
      submitButton.style.display = "none";
      input.disabled = true;
      const boardButton = buildButton("🏆 View leaderboard", "btn-sm", () => showLeaderboardModal(callsign));
      status.appendChild(document.createElement("br"));
      status.appendChild(boardButton);
    } else {
      status.className = "status-msg wait";
      status.textContent = data.message || "An equal or higher score is already saved for this callsign.";
      submitButton.disabled = false;
      input.disabled = false;
    }
  } catch (error) {
    status.className = "status-msg err";
    status.textContent = `Could not save the score: ${error.message} Check the Worker URL, allowed website origin and Cloudflare setup.`;
    submitButton.disabled = false;
    input.disabled = false;
  } finally {
    submittingScore = false;
  }
}

/* ---------- Accessible modal system ---------- */
function openModal(title, content) {
  const overlay = $("ov");
  previousFocus = document.activeElement;
  const card = makeElement("div", "card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "modal-title");

  const close = buildButton("×", "card-close", () => closeModal());
  close.setAttribute("aria-label", "Close dialog");
  const heading = makeElement("h2", "", title);
  heading.id = "modal-title";
  card.append(close, heading, content);
  overlay.replaceChildren(card);
  overlay.hidden = false;
  close.focus();
}

function closeModal(restoreFocus = true) {
  const overlay = $("ov");
  overlay.hidden = true;
  overlay.replaceChildren();
  if (restoreFocus && previousFocus instanceof HTMLElement) previousFocus.focus();
}

function showFieldGuideModal() {
  playSound("click");
  const content = document.createElement("div");
  const items = [
    ["🛰️ Mission goal", "Keep four crew members supplied for 60 mission turns in either the Moon or Mars game scenario."],
    ["💨 Oxygen", "The game crew uses 3.4 kg of oxygen per turn. The production module is fictionalized and is not MOXIE."],
    ["🌱 Food", "The game crew uses 3 kg of food per turn. A small greenhouse is a supplement, not a complete diet."],
    ["⚡ Energy", "Power is measured in kW. Energy over a 24-hour game turn is measured in kWh. Batteries store kWh."],
    ["☢️ Radiation", "The radiation meter and its 100 mSv failure point are game mechanics, not an official universal NASA limit."],
    ["🔬 Research", "Science earns Build Points. Build costs, production rates, events and upgrades are game-balancing values."]
  ];
  for (const [heading, description] of items) {
    const box = makeElement("div", "tip");
    box.appendChild(makeElement("h3", "", heading));
    addParagraph(box, description);
    content.appendChild(box);
  }
  openModal("📖 Commander's field guide", content);
}

async function showLeaderboardModal(highlightCallsign = "", filter = "all") {
  playSound("click");
  const content = document.createElement("div");
  const tabs = makeElement("div", "lb-tabs");
  const tableWrap = makeElement("div", "table-wrap");
  const table = makeElement("table", "lb-table");
  const status = makeElement("p", "status-msg wait", "Loading shared leaderboard…");
  const filters = [
    ["all", "All missions"], ["moon", "🌕 Moon"], ["mars", "🔴 Mars"]
  ];

  for (const [value, label] of filters) {
    const tab = buildButton(label, `lb-tab ${filter === value ? "active" : ""}`, () => showLeaderboardModal(highlightCallsign, value));
    tab.setAttribute("aria-pressed", String(filter === value));
    tabs.appendChild(tab);
  }

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  for (const label of ["Rank", "Callsign", "World", "Turns", "Science", "Score"]) {
    headerRow.appendChild(makeElement("th", "", label));
  }
  thead.appendChild(headerRow);
  const tbody = document.createElement("tbody");
  table.append(thead, tbody);
  tableWrap.appendChild(table);
  content.append(tabs, status, tableWrap);
  openModal("🏆 Shared leaderboard", content);

  try {
    const response = await fetch(`${API_BASE}/api/leaderboard?world=${encodeURIComponent(filter)}`, {
      method: "GET",
      headers: { "Accept": "application/json" }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Server returned ${response.status}.`);

    status.remove();
    const records = Array.isArray(data.records) ? data.records : [];
    if (records.length === 0) {
      const row = document.createElement("tr");
      const cell = makeElement("td", "", "No mission records yet. Be the first commander!");
      cell.colSpan = 6;
      row.appendChild(cell);
      tbody.appendChild(row);
      return;
    }

    records.forEach((record, index) => {
      const row = document.createElement("tr");
      if (highlightCallsign && String(record.callsign).toLowerCase() === highlightCallsign.toLowerCase()) {
        row.className = "lb-row-new";
      }
      const values = [
        index + 1,
        record.callsign,
        record.world,
        record.turns,
        Number(record.science).toFixed(1),
        record.score
      ];
      values.forEach((value) => row.appendChild(makeElement("td", "", value)));
      tbody.appendChild(row);
    });
  } catch (error) {
    status.className = "status-msg err";
    status.textContent = `Leaderboard unavailable: ${error.message}`;
  }
}

function showStartModal() {
  const content = document.createElement("div");
  addParagraph(content, "Welcome to Outpost Zero! Balance electricity, oxygen, food, radiation protection and science to maintain a planetary habitat for 60 mission turns.");

  const note = makeElement("div", "tip");
  note.appendChild(makeElement("h3", "", "⚡ The core challenge"));
  addParagraph(note, "Solar power varies with the simplified lighting scenario. Batteries store energy, while the fission power unit supplies steady power according to the game model. Protect life support before running optional research.");
  content.appendChild(note);
  addParagraph(content, `🌕 Moon: ${SITES.moon.description}`);
  addParagraph(content, `🔴 Mars: ${SITES.mars.description}`);
  addParagraph(content, "Choose your destination:");
  const row = makeElement("div", "card-row");
  row.append(
    buildButton("🌕 Moon base", "pick", () => createMission("moon")),
    buildButton("🔴 Mars base", "pick", () => createMission("mars"))
  );
  content.appendChild(row);
  addParagraph(content, "Outpost Zero is an independent educational game and is not an official NASA product or mission simulator.", "fine-print");
  openModal("🛰️ Outpost Zero", content);
}

/* ---------- Event wiring ---------- */
$("shop").addEventListener("click", (event) => {
  if (!S || S.over) return;
  const button = event.target.closest("button[data-module]");
  if (!button || button.disabled) return;
  const key = button.dataset.module;
  const item = MODULES[key];
  if (!item || S.bp < item.cost || S.modules[key] >= item.max) return;

  S.bp -= item.cost;
  S.modules[key] += 1;
  addLog(`Upgrade built: ${item.name} (now ${S.modules[key]}).`, "ok");
  playSound("buy");
  updateUI();
});

["s_o2", "s_gh", "s_lab", "shel"].forEach((id) => {
  $(id).addEventListener("input", updateUI);
  $(id).addEventListener("change", updateUI);
});

$("go").addEventListener("click", runTurn);
$("btn_audio").addEventListener("click", toggleSound);
$("btn_lb").addEventListener("click", () => showLeaderboardModal());
$("btn_guide").addEventListener("click", showFieldGuideModal);

$("ov").addEventListener("click", (event) => {
  if (event.target === $("ov")) closeModal();
});

document.addEventListener("keydown", (event) => {
  const overlay = $("ov");
  if (overlay.hidden) return;
  if (event.key === "Escape") {
    closeModal();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...overlay.querySelectorAll("button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex='-1'])")];
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

/* ---------- Start ---------- */
// The visible game waits for the player to choose Moon or Mars.
S = null;
updateUI();
showStartModal();
