"use strict";

/*
 * Outpost Zero
 * Planetary habitat operations simulator.
 * Mission operations and resource rates are configurable planning parameters.
 * This is an independent educational simulator, not an official NASA system.
 */

const API_BASE = "https://outpost-moderator.ramneek-space.workers.dev";
const DAY_HOURS = 24;
const MISSION_DAYS = 60;
const BASE_LOAD_KW = 4;
const MIN_BASE_POWER_FRACTION = 0.8;

const SITES = {
    moon: {
        name: "Moon",
        fullName: "Lunar South Pole",
        solarKW: 8,
        basePanels: 5,
        baseDose: 1.36,
        flareDose: 25,
        sky: "#030712",
        ground: "#7e838f",
        description:
            "The lunar south pole receives highly variable sunlight. Crater rims and local terrain can create extended periods of illumination and persistent shadow.",
    },
    mars: {
        name: "Mars",
        fullName: "Jezero Crater",
        solarKW: 3.5,
        basePanels: 12,
        sunlightFactor: 0.44,
        baseDose: 0.67,
        flareDose: 20,
        sky: "#a8542b",
        ground: "#7c351e",
        description:
            "Mars receives less sunlight than Earth. Atmospheric dust and regional dust storms can significantly reduce solar-array output.",
    },
};

const MODULES = {
    solar: {
        icon: "☀️",
        name: "Solar Array",
        cost: 30,
        max: 30,
        description:
            "+8 kW per panel on the Moon during daylight / +1.54 kW per panel on Mars under nominal conditions.",
    },
    battery: {
        icon: "🔋",
        name: "Battery Unit",
        cost: 25,
        max: 20,
        description: "+40 kWh energy storage capacity.",
    },
    reactor: {
        icon: "⚛️",
        name: "Fission Power Unit",
        cost: 120,
        max: 3,
        description: "+24 kW continuous electrical output, day and night.",
    },
    oxygen: {
        icon: "💨",
        name: "Oxygen Production Unit",
        cost: 35,
        max: 5,
        description:
            "Oxygen production: +1.7 kg O₂/day at full output; electrical demand: 4 kW.",
    },
    greenhouse: {
        icon: "🌱",
        name: "Greenhouse Module",
        cost: 40,
        max: 5,
        description:
            "Fresh-food production: +1.5 kg/day at full output; electrical demand: 3 kW.",
    },
    lab: {
        icon: "🔬",
        name: "Science Laboratory",
        cost: 50,
        max: 4,
        description:
            "Research output: +3 science units/day at full output; electrical demand: 2 kW.",
    },
    shield: {
        icon: "🛡️",
        name: "Regolith Shield Layer",
        cost: 45,
        max: 8,
        description:
            "Each installed layer reduces the habitat radiation dose calculated by the mission model.",
    },
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
        const AudioContextClass =
            window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;

        audioContext ??= new AudioContextClass();
        if (audioContext.state === "suspended") audioContext.resume();

        const now = audioContext.currentTime;
        const presets = {
            click: {
                wave: "sine",
                start: 420,
                end: 760,
                duration: 0.06,
                volume: 0.055,
            },
            buy: {
                wave: "triangle",
                start: 340,
                end: 720,
                duration: 0.22,
                volume: 0.075,
            },
            day: {
                wave: "sine",
                start: 250,
                end: 520,
                duration: 0.16,
                volume: 0.065,
            },
            alert: {
                wave: "sawtooth",
                start: 360,
                end: 260,
                duration: 0.2,
                volume: 0.07,
            },
            win: {
                wave: "triangle",
                start: 520,
                end: 900,
                duration: 0.32,
                volume: 0.07,
            },
        };

        const preset = presets[type];
        if (!preset) return;

        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = preset.wave;
        oscillator.frequency.setValueAtTime(preset.start, now);
        oscillator.frequency.exponentialRampToValueAtTime(
            preset.end,
            now + preset.duration,
        );
        gain.gain.setValueAtTime(preset.volume, now);
        gain.gain.linearRampToValueAtTime(0, now + preset.duration);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(now);
        oscillator.stop(now + preset.duration);
    } catch (error) {
        // Sound is optional. Audio failures must never interrupt mission operations.
        console.debug("Sound effect unavailable:", error);
    }
}

function syncSoundButton() {
    const button = $("btn_audio");
    if (!button) return;

    button.textContent = soundEnabled ? "🔊 Sound on" : "🔇 Sound off";
    button.setAttribute("aria-label", soundEnabled ? "Sound on" : "Sound off");
    button.setAttribute("aria-pressed", String(soundEnabled));
    button.title = soundEnabled
        ? "Sound effects are on. Click to turn them off."
        : "Sound effects are off. Click to turn them on.";
}

function toggleSound() {
    soundEnabled = !soundEnabled;
    syncSoundButton();
    if (soundEnabled) playSound("click");
}

/* ---------- Small DOM helpers ---------- */
function makeElement(tag, className = "", text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
}

function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = String(value);
}

function addParagraph(parent, text, className = "") {
    const paragraph = makeElement("p", className, text);
    parent.appendChild(paragraph);
    return paragraph;
}

/* ---------- Mission state ---------- */
function createMission(site) {
    const definition = SITES[site];
    if (!definition) throw new Error("Unknown destination.");

    S = {
        site,
        day: 1,
        bp: 120,
        science: 0,
        batteryKWh: 160,
        oxygenKg: 30,
        foodKg: 40,
        radiationMsv: 0,
        starvationDays: 0,
        coldDays: 0,
        cropBlightDays: 0,
        dustStormDays: 0,
        flareNextDay: false,
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
            shield: 1,
        },
    };

    $("s_o2").value = "100";
    $("s_gh").value = "100";
    $("s_lab").value = "50";
    $("shel").checked = false;
    ["s_o2", "s_gh", "s_lab", "shel", "go"].forEach((id) => {
        $(id).disabled = false;
    });

    addLog(
        `Mission initiated: ${definition.fullName}. Maintain crew supplies throughout the ${MISSION_DAYS}-day mission.`,
        "ok",
    );
    closeModal(false);
    updateUI();
    playSound("click");
}

function addLog(message, type = "") {
    if (!S) return;
    S.log.unshift({ day: S.day, message, type });
    S.log = S.log.slice(0, 20);
    renderLog();
}

/* ---------- Lighting and power model ---------- */
function sunlightFactor() {
    if (S.site === "moon") {
        // Lunar illumination planning cycle: 8 daylight days followed by 4 shadow days.
        return (S.day - 1) % 12 < 8 ? 1 : 0;
    }

    const ordinarySunlight = SITES.mars.sunlightFactor;
    return S.dustStormDays > 0 ? ordinarySunlight * 0.2 : ordinarySunlight;
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
        lab: Number($("s_lab").value) / 100,
    };
    const sun = sunlightFactor();
    const site = SITES[S.site];

    const solarKW = modules.solar * site.solarKW * sun;
    const reactorKW = modules.reactor * 24;
    const generationKW = solarKW + reactorKW;
    const generationKWh = generationKW * DAY_HOURS;

    const requestedKWh = {
        base: BASE_LOAD_KW * DAY_HOURS,
        oxygen: modules.oxygen * 4 * settings.oxygen * DAY_HOURS,
        greenhouse: modules.greenhouse * 3 * settings.greenhouse * DAY_HOURS,
        lab: shelter ? 0 : modules.lab * 2 * settings.lab * DAY_HOURS,
    };

    const availableKWh = generationKWh + S.batteryKWh;
    const allocation = allocateEnergy(availableKWh, requestedKWh);
    const demandKWh = Object.values(requestedKWh).reduce(
        (total, value) => total + value,
        0,
    );
    const batteryCapacityKWh = modules.battery * 40;

    const oxygenProducedKg =
        modules.oxygen * 1.7 * settings.oxygen * allocation.fractions.oxygen;
    const greenhouseHarvestKg =
        modules.greenhouse *
        1.5 *
        settings.greenhouse *
        allocation.fractions.greenhouse *
        (shelter ? 0.5 : 1) *
        (S.cropBlightDays > 0 ? 0.5 : 1);
    const scienceEarned = shelter
        ? 0
        : modules.lab * 3 * settings.lab * allocation.fractions.lab;

    return {
        shelter,
        generationKW,
        generationKWh,
        demandKWh,
        fractions: allocation.fractions,
        usedKWh: allocation.usedKWh,
        batteryCapacityKWh,
        oxygenProducedKg,
        greenhouseHarvestKg,
        scienceEarned,
    };
}

/* ---------- Rendering ---------- */
function renderGauge(
    container,
    label,
    value,
    maximum,
    colorVariable,
    detail,
    rightText = "",
) {
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
        ["Day", `${S.day} / ${MISSION_DAYS}`],
        ["Build Points", `${Math.floor(S.bp)} BP`],
        ["Science", format1(S.science)],
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

    renderGauge(
        container,
        "🔋 Battery",
        S.batteryKWh,
        plan.batteryCapacityKWh,
        "pw",
        `${Math.round(S.batteryKWh)} / ${plan.batteryCapacityKWh} kWh`,
        `${Math.round((S.batteryKWh / plan.batteryCapacityKWh) * 100)}%`,
    );
    renderGauge(
        container,
        "💨 Oxygen",
        S.oxygenKg,
        60,
        "o2",
        `${format1(S.oxygenKg)} / 60 kg`,
        `${Math.round((S.oxygenKg / 60) * 100)}%`,
    );
    renderGauge(
        container,
        "🍎 Food",
        S.foodKg,
        80,
        "fd",
        `${format1(S.foodKg)} / 80 kg`,
        `${Math.round((S.foodKg / 80) * 100)}%`,
    );
    renderGauge(
        container,
        "☢️ Radiation",
        S.radiationMsv,
        100,
        "rad",
        `${format1(S.radiationMsv)} / 100 mSv cumulative dose`,
        S.radiationMsv >= 75 ? "HIGH" : "NOMINAL",
    );

    const shieldReduction = (1 - Math.pow(0.75, modules.shield)) * 100;
    renderGauge(
        container,
        "🛡️ Radiation Shield",
        modules.shield,
        8,
        "rad",
        `${modules.shield} / 8 layers`,
        `${Math.round(shieldReduction)}% estimated dose reduction`,
    );
}

function renderForecast(plan) {
    const container = $("fc");
    container.replaceChildren();

    const addMetric = (label, value, detail = "") => {
        const row = makeElement("p", "forecast-metric");
        row.appendChild(makeElement("span", "forecast-label", label));
        row.appendChild(makeElement("strong", "forecast-value", value));
        if (detail) {
            row.appendChild(makeElement("small", "forecast-detail", detail));
        }
        container.appendChild(row);
    };

    const netKW = plan.generationKW - plan.demandKWh / DAY_HOURS;
    const oxygenNet = plan.oxygenProducedKg - 3.4;
    const foodNet = plan.greenhouseHarvestKg - 3;

    addMetric(
        "Power generation",
        `${format1(plan.generationKW)} kW`,
        "Available electrical output",
    );
    addMetric(
        "Power demand",
        `${format1(plan.demandKWh / DAY_HOURS)} kW`,
        "Required average electrical load",
    );
    addMetric(
        "Net power balance",
        `${netKW >= 0 ? "+" : ""}${format1(netKW)} kW`,
        "Before battery discharge",
    );
    addMetric(
        "Daily energy",
        `${Math.round(plan.generationKWh)} kWh generated`,
        `${Math.round(plan.usedKWh)} kWh allocated to systems`,
    );

    if (plan.fractions.base < MIN_BASE_POWER_FRACTION) {
        addParagraph(
            container,
            "Critical: habitat baseline power is below the required operating level.",
            "warn forecast-alert",
        );
    } else if (plan.fractions.oxygen < 0.99) {
        addParagraph(
            container,
            "Warning: oxygen production is being reduced by an electrical power shortage.",
            "warn forecast-alert",
        );
    } else if (plan.fractions.greenhouse < 0.99) {
        addParagraph(
            container,
            "Warning: greenhouse output is being reduced by an electrical power shortage.",
            "warn forecast-alert",
        );
    }

    addMetric(
        "Oxygen balance",
        `${oxygenNet >= 0 ? "+" : ""}${format1(oxygenNet)} kg/day`,
        "Production minus crew consumption",
    );
    addMetric(
        "Food balance",
        `${foodNet >= 0 ? "+" : ""}${format1(foodNet)} kg/day`,
        "Harvest minus crew consumption",
    );

    const sun = sunlightFactor();
    let environmentText;
    if (S.site === "moon") {
        environmentText =
            sun > 0
                ? "Lunar illumination: sunlight is available at the habitat site."
                : "Lunar illumination: the habitat site is in shadow; stored energy supports operations.";
    } else {
        environmentText =
            S.dustStormDays > 0
                ? `Martian atmospheric dust: solar-array output is reduced for ${S.dustStormDays} more day(s).`
                : "Martian atmospheric conditions: nominal solar-array output.";
    }

    addParagraph(container, environmentText, "forecast-note");

    if (S.flareNextDay) {
        addParagraph(
            container,
            "Solar particle event forecast for the next day. Storm shelter activation is recommended.",
            "warn forecast-alert",
        );
    }
}

function renderScene() {
    const site = SITES[S.site];
    const sun = sunlightFactor();
    $("scene").style.background =
        `linear-gradient(${S.dustStormDays > 0 ? "#542a17" : site.sky} 62%, ${site.ground} 62%)`;
    setText("earth", S.site === "moon" ? "🌍" : "");
    setText(
        "sun",
        S.site === "moon"
            ? sun > 0
                ? "☀️"
                : "🌑"
            : S.dustStormDays > 0
              ? "🌪️"
              : "☀️",
    );
    setText(
        "sky_status",
        S.site === "moon"
            ? sun > 0
                ? "LUNAR DAYLIGHT"
                : "LUNAR SHADOW"
            : S.dustStormDays > 0
              ? "MARTIAN DUST STORM"
              : "MARTIAN ATMOSPHERIC CONDITIONS: NOMINAL",
    );

    const base = $("base");
    base.replaceChildren();
    const labels = [
        ["solar", "☀️", "Solar"],
        ["battery", "🔋", "Battery"],
        ["reactor", "⚛️", "Power"],
        ["oxygen", "💨", "Oxygen"],
        ["greenhouse", "🌱", "Greenhouse"],
        ["lab", "🔬", "Lab"],
        ["shield", "🛡️", "Radiation Shield"],
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
        heading.append(
            `${item.icon} `,
            makeElement("b", "", `${item.name} ×${count}`),
        );
        button.appendChild(heading);
        button.appendChild(makeElement("small", "", item.description));
        button.appendChild(
            makeElement(
                "span",
                "cost",
                maximum ? "MAX LEVEL" : `${item.cost} BP`,
            ),
        );
        shop.appendChild(button);
    }
}

function renderLog() {
    const log = $("log");
    if (!S || !log) return;

    // Preserve the reader's position when a new entry is inserted above it.
    const previousHeight = log.scrollHeight;
    const previousTop = log.scrollTop;
    const wasAtTop = previousTop <= 4;

    log.replaceChildren();
    for (const entry of S.log.slice(0, 20)) {
        const paragraph = makeElement(
            "p",
            `log-entry ${entry.type}`,
            `Day ${entry.day}: ${entry.message}`,
        );
        log.appendChild(paragraph);
    }

    if (wasAtTop) {
        log.scrollTop = 0;
    } else {
        log.scrollTop = previousTop + (log.scrollHeight - previousHeight);
    }
}

function updateUI() {
    if (!S) {
        // Keep mission controls inactive until a destination is selected.
        $("go").disabled = true;
        ["s_o2", "s_gh", "s_lab", "shel"].forEach((id) => {
            $(id).disabled = true;
        });
        $("stats").textContent = "Choose a destination to begin";
        $("gauges").textContent = "Mission resources will appear here.";
        $("fc").textContent =
            "Allocate energy carefully to protect life-support systems.";
        $("shop").textContent =
            "Choose Moon or Mars to unlock habitat upgrades.";
        $("log").textContent = "Mission log ready.";
        $("scene").style.background =
            "linear-gradient(#08172a 62%, #303c4d 62%)";
        $("sky_status").textContent = "AWAITING DESTINATION";
        return;
    }

    const plan = calculatePlan();
    renderStats();
    renderGauges(plan);
    renderForecast(plan);
    renderScene();
    renderShop();

    // Do not rerender the log here: slider changes should not reset its scroll position.
    for (const key of ["o2", "gh", "lab"]) {
        const slider = $(`s_${key}`);
        const label = $(`v_${key}`);
        const percent = Number(slider.value);
        label.textContent = `${percent}%`;
    }

    $("go").textContent = `Advance Day ${S.day} ▶`;
}

/* ---------- Day processing ---------- */
function checkFailure() {
    if (S.oxygenKg <= 0) return "oxygen";
    if (S.starvationDays >= 4) return "food";
    if (S.radiationMsv >= 100) return "radiation";
    if (S.coldDays >= 2) return "cold";
    return "";
}

function runDay() {
    if (!S || S.over) return;
    playSound("day");

    const plan = calculatePlan();
    const modules = S.modules;
    const shelterFactor = plan.shelter ? 0.5 : 1;

    // kWh = kW × hours. Battery capacity and energy use are therefore comparable.
    S.batteryKWh = clamp(
        S.batteryKWh + plan.generationKWh - plan.usedKWh,
        0,
        plan.batteryCapacityKWh,
    );
    S.oxygenKg = clamp(S.oxygenKg + plan.oxygenProducedKg - 3.4, 0, 60);
    S.foodKg = clamp(S.foodKg + plan.greenhouseHarvestKg - 3, 0, 80);
    S.science += plan.scienceEarned;
    S.bp += 12 + Math.round(plan.scienceEarned * 3);

    const shieldFactor = Math.pow(0.75, modules.shield) * shelterFactor;
    let receivedDose = SITES[S.site].baseDose * shieldFactor;
    if (S.flareNextDay) {
        receivedDose += SITES[S.site].flareDose * shieldFactor;
        addLog(
            `Solar particle event: ${format1(SITES[S.site].flareDose * shieldFactor)} mSv added to the daily dose.`,
            "bad",
        );
        S.flareNextDay = false;
        playSound("alert");
    }
    S.radiationMsv += receivedDose;

    if (plan.fractions.base < MIN_BASE_POWER_FRACTION) {
        S.coldDays += 1;
        addLog(
            "Habitat baseline power fell below the required operating level. Thermal reserves are being depleted.",
            "bad",
        );
    } else {
        S.coldDays = 0;
    }

    if (S.foodKg <= 0) {
        S.starvationDays += 1;
        addLog(
            `Food stores are empty (${S.starvationDays}/4 consecutive days).`,
            "bad",
        );
        playSound("alert");
    } else {
        // The failure rule is based on consecutive days without food.
        S.starvationDays = 0;
    }

    if (S.dustStormDays > 0) S.dustStormDays -= 1;
    if (S.cropBlightDays > 0) S.cropBlightDays -= 1;

    const failure = checkFailure();
    if (failure) {
        finishMission(false, failure);
        return;
    }

    if (S.day >= MISSION_DAYS) {
        finishMission(true, "success");
        return;
    }

    S.day += 1;
    if (Math.random() < 0.4) triggerEvent();

    const eventFailure = checkFailure();
    if (eventFailure) {
        finishMission(false, eventFailure);
        return;
    }

    updateUI();
}

function triggerEvent() {
    const roll = Math.random();
    const modules = S.modules;

    if (roll < 0.25 && !S.flareNextDay) {
        S.flareNextDay = true;
        addLog(
            "Solar weather alert: a solar particle event is forecast for the next day. Consider using the shelter.",
            "bad",
        );
        playSound("alert");
        return;
    }

    if (roll < 0.45 && S.site === "mars" && S.dustStormDays === 0) {
        S.dustStormDays = 4;
        addLog(
            "Atmospheric dust event: solar-array output is reduced to 20% for the next four days.",
            "bad",
        );
        playSound("alert");
        return;
    }

    if (roll < 0.6) {
        const loss = Math.min(8, S.oxygenKg);
        S.oxygenKg = Math.max(0, S.oxygenKg - loss);
        addLog(
            `Habitat maintenance alert: an air-system leak reduced stored oxygen reserves by ${format1(loss)} kg.`,
            "bad",
        );
        playSound("alert");
        return;
    }

    if (roll < 0.74 && S.cropBlightDays === 0) {
        S.cropBlightDays = 3;
        addLog(
            "Greenhouse alert: crop-health monitoring detected an issue. Harvest output is reduced by 50% for three days.",
            "bad",
        );
        playSound("alert");
        return;
    }

    if (roll < 0.89) {
        const repairable = ["oxygen", "greenhouse", "solar", "lab"].filter(
            (key) => modules[key] > 1,
        );
        if (repairable.length > 0) {
            const selected =
                repairable[Math.floor(Math.random() * repairable.length)];
            modules[selected] -= 1;
            addLog(
                `Maintenance event: one ${MODULES[selected].name} module is offline. Rebuild it using BP.`,
                "bad",
            );
            playSound("alert");
            return;
        }
    }

    S.bp += 50;
    addLog(
        "Cargo resupply received: +50 Build Points added to the mission account.",
        "ok",
    );
    playSound("buy");
}

/* ---------- Mission ending and score submission ---------- */
function calculateDisplayedScore(won) {
    return Math.round(
        S.science * 12 +
            S.day * 10 +
            Math.max(0, 100 - S.radiationMsv) * 3 +
            (won ? 300 : 0),
    );
}

const DEBRIEFS = {
    oxygen: "Stored oxygen ran out. Real spacecraft use carefully designed life-support systems, monitoring and backup equipment.",
    food: "Food reserves were depleted for too many consecutive days. Crew provisions require careful planning; greenhouse production is a supplement to stored food.",
    radiation:
        "The mission radiation-dose threshold of 100 mSv was reached. Actual astronaut exposure limits depend on mission duration, age, and applicable radiation standards.",
    cold: "The habitat did not receive adequate baseline power for two consecutive days. Thermal control is essential to crew safety.",
    success:
        "Mission complete. The crew maintained the habitat throughout the 60-day mission.",
};

function finishMission(won, reason) {
    if (S.over) return;
    S.over = true;
    S.won = won;
    ["s_o2", "s_gh", "s_lab", "shel", "go"].forEach((id) => {
        $(id).disabled = true;
    });
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

    addParagraph(
        content,
        `Mission performance score: ${score} points · Day ${S.day} · ${format1(S.science)} science units · Cumulative radiation dose: ${format1(S.radiationMsv)} mSv.`,
    );

    const debrief = makeElement("div", "tip");
    debrief.appendChild(makeElement("h3", "", "🛰️ Mission debrief"));
    addParagraph(
        debrief,
        DEBRIEFS[reason] ||
            "Review your resource allocation and try another mission.",
    );
    content.appendChild(debrief);

    const submitBox = makeElement("div", "submit-box");
    submitBox.appendChild(
        makeElement("h3", "", "🏆 Save to the shared leaderboard"),
    );
    addParagraph(
        submitBox,
        "Choose a callsign, not your real name. Do not include your school, location, contact details or other personal information.",
    );

    const inputLabel = makeElement(
        "label",
        "",
        "Astronaut callsign (2–20 letters, numbers, _ or -)",
    );
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

    const status = makeElement("div", "status-msg");
    status.id = "submit_status";
    status.setAttribute("role", "status");

    const submit = buildButton("🚀 Save score", "btn-primary", () =>
        submitScore(input, submit, status),
    );
    submit.style.width = "auto";
    inputRow.append(input, submit);
    submitBox.appendChild(inputRow);

    const help = makeElement(
        "p",
        "fine-print",
        "Only use a made-up callsign. The Worker checks callsigns before storing them.",
    );
    help.id = "callsign_help";
    submitBox.appendChild(help);
    submitBox.appendChild(status);
    content.appendChild(submitBox);

    const restartRow = makeElement("div", "card-row");
    restartRow.append(
        buildButton("🌕 New Moon mission", "pick", () => createMission("moon")),
        buildButton("🔴 New Mars mission", "pick", () => createMission("mars")),
    );
    content.appendChild(restartRow);

    openModal(
        won ? "🎉 Mission successful!" : `🚨 Mission ended on Day ${S.day}`,
        content,
    );
    input.focus();
}

async function submitScore(input, submitButton, status) {
    if (submittingScore || !S || !S.over) return;

    const callsign = input.value.trim();
    if (!/^[A-Za-z0-9_-]{2,20}$/.test(callsign)) {
        status.className = "status-msg err";
        status.textContent =
            "Use 2–20 characters: letters, numbers, underscores or hyphens only.";
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
        turns: S.day,
        science: Number(S.science.toFixed(2)),
        radiation: Number(S.radiationMsv.toFixed(2)),
        won: Boolean(S.won),
    };

    try {
        const response = await fetch(`${API_BASE}/api/scores`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(
                data.error || `Server returned ${response.status}.`,
            );
        }

        if (data.saved) {
            status.className = "status-msg succ";
            status.textContent = `${data.message || "Mission record saved."} Server-calculated score: ${data.score} points.`;
            submitButton.textContent = "Saved";
            submitButton.style.display = "none";
            input.disabled = true;

            const boardButton = buildButton(
                "🏆 View leaderboard",
                "btn-sm",
                () => showLeaderboardModal(callsign),
            );
            status.appendChild(document.createElement("br"));
            status.appendChild(boardButton);
        } else {
            status.className = "status-msg wait";
            status.textContent =
                data.message ||
                "An equal or higher score is already saved for this callsign.";
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
function openModal(title, content, options = {}) {
    const overlay = $("ov");
    const dismissible = options.dismissible !== false;
    previousFocus = document.activeElement;

    const card = makeElement("div", "card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "modal-title");

    if (dismissible) {
        const close = buildButton("×", "card-close", () => closeModal());
        close.setAttribute("aria-label", "Close dialog");
        card.appendChild(close);
    }

    const heading = makeElement("h2", "", title);
    heading.id = "modal-title";
    card.append(heading, content);
    overlay.replaceChildren(card);
    overlay.dataset.dismissible = String(dismissible);
    overlay.hidden = false;

    const firstFocusable = card.querySelector(
        "button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex='-1'])",
    );
    firstFocusable?.focus();
}

function closeModal(restoreFocus = true) {
    const overlay = $("ov");
    overlay.hidden = true;
    overlay.replaceChildren();
    overlay.dataset.dismissible = "true";

    if (restoreFocus && previousFocus instanceof HTMLElement) {
        previousFocus.focus();
    }
}

function showFieldGuideModal() {
    playSound("click");
    const content = document.createElement("div");
    const items = [
        [
            "🛰️ Mission goal",
            "Maintain supplies for four crew members throughout a 60-day lunar or martian surface mission.",
        ],
        [
            "💨 Oxygen",
            "Crew oxygen planning is set to 3.4 kg per day for four crew members. Oxygen generation capacity depends on the installed production system.",
        ],
        [
            "🌱 Food",
            "Food planning is set to 3 kg per day. Greenhouse production supplements stored provisions.",
        ],
        [
            "⚡ Energy",
            "Power is measured in kW. Energy over a 24-hour period is measured in kWh. Battery systems store electrical energy in kWh.",
        ],
        [
            "☢️ Radiation",
            "The 100 mSv alert threshold is a mission planning parameter, not a universal astronaut exposure limit. Actual limits depend on mission duration, age and applicable radiation standards.",
        ],
        [
            "🔬 Research",
            "Science output contributes to mission planning resources. Equipment costs, production rates, event frequencies and performance thresholds are configurable mission parameters.",
        ],
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
    const status = makeElement(
        "p",
        "status-msg wait",
        "Loading shared leaderboard…",
    );
    const filters = [
        ["all", "All missions"],
        ["moon", "🌕 Moon"],
        ["mars", "🔴 Mars"],
    ];

    for (const [value, label] of filters) {
        const tab = buildButton(
            label,
            `lb-tab ${filter === value ? "active" : ""}`,
            () => showLeaderboardModal(highlightCallsign, value),
        );
        tab.setAttribute("aria-pressed", String(filter === value));
        tabs.appendChild(tab);
    }

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    for (const label of [
        "Rank",
        "Callsign",
        "World",
        "Days",
        "Science",
        "Score",
    ]) {
        headerRow.appendChild(makeElement("th", "", label));
    }
    thead.appendChild(headerRow);

    const tbody = document.createElement("tbody");
    table.append(thead, tbody);
    tableWrap.appendChild(table);
    content.append(tabs, status, tableWrap);
    openModal("🏆 Shared leaderboard", content);

    try {
        const response = await fetch(
            `${API_BASE}/api/leaderboard?world=${encodeURIComponent(filter)}`,
            {
                method: "GET",
                headers: { Accept: "application/json" },
            },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(
                data.error || `Server returned ${response.status}.`,
            );
        }

        status.remove();
        const records = Array.isArray(data.records) ? data.records : [];
        if (records.length === 0) {
            const row = document.createElement("tr");
            const cell = makeElement(
                "td",
                "",
                "No mission records yet. Be the first commander!",
            );
            cell.colSpan = 6;
            row.appendChild(cell);
            tbody.appendChild(row);
            return;
        }

        records.forEach((record, index) => {
            const row = document.createElement("tr");
            if (
                highlightCallsign &&
                String(record.callsign).toLowerCase() ===
                    highlightCallsign.toLowerCase()
            ) {
                row.className = "lb-row-new";
            }

            const values = [
                index + 1,
                record.callsign,
                record.world,
                record.turns,
                Number(record.science).toFixed(1),
                record.score,
            ];
            values.forEach((value) => {
                row.appendChild(makeElement("td", "", value));
            });
            tbody.appendChild(row);
        });
    } catch (error) {
        status.className = "status-msg err";
        status.textContent = `Leaderboard unavailable: ${error.message}`;
    }
}

function showStartModal() {
    const content = document.createElement("div");
    addParagraph(
        content,
        "Welcome to Outpost Zero. Maintain a planetary habitat for a 60-day surface mission by balancing electrical power, oxygen, food, radiation protection and research objectives.",
    );

    const note = makeElement("div", "tip");
    note.appendChild(makeElement("h3", "", "⚡ The core challenge"));
    addParagraph(
        note,
        "Solar generation depends on local illumination on the Moon and atmospheric conditions on Mars. Batteries provide stored energy during low-generation periods, while the fission power system supplies continuous electrical power. Prioritize life-support systems before optional research.",
    );
    content.appendChild(note);
    addParagraph(content, `🌕 Moon: ${SITES.moon.description}`);
    addParagraph(content, `🔴 Mars: ${SITES.mars.description}`);
    addParagraph(content, "Choose your destination:");

    const row = makeElement("div", "card-row");
    row.append(
        buildButton("🌕 Moon base", "pick", () => createMission("moon")),
        buildButton("🔴 Mars base", "pick", () => createMission("mars")),
    );
    content.appendChild(row);
    addParagraph(
        content,
        "Outpost Zero is an independent educational simulator and is not an official NASA product or mission system.",
        "fine-print",
    );

    // The first destination picker cannot be dismissed without choosing a mission.
    // Later, the persistent header button can reopen a dismissible destination picker.
    openModal("🛰️ Outpost Zero", content, { dismissible: Boolean(S) });
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

$("go").addEventListener("click", runDay);
$("btn_audio").addEventListener("click", toggleSound);
$("btn_lb").addEventListener("click", () => showLeaderboardModal());
$("btn_guide").addEventListener("click", showFieldGuideModal);
$("btn_new_mission").addEventListener("click", showStartModal);

$("ov").addEventListener("click", (event) => {
    const overlay = $("ov");
    if (event.target === overlay && overlay.dataset.dismissible === "true") {
        closeModal();
    }
});

document.addEventListener("keydown", (event) => {
    const overlay = $("ov");
    if (overlay.hidden) return;

    if (event.key === "Escape") {
        if (overlay.dataset.dismissible === "true") {
            closeModal();
        }
        return;
    }

    if (event.key !== "Tab") return;

    const focusable = [
        ...overlay.querySelectorAll(
            "button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex='-1'])",
        ),
    ];
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
// Show the current sound state immediately; no initial click is needed.
syncSoundButton();
// The mission interface waits for the player to select a destination.
S = null;
updateUI();
showStartModal();
