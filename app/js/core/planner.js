// Wochenplaner, Schritt für Schritt wie TrainingPlanner in der App
// (GolfCore/Sources/GolfCore/Planning/TrainingPlanner.swift). Ändert sich dort
// etwas, schlägt der Test mit Fixtures/web-planner.json fehl, bis beide wieder
// dasselbe rechnen. Ablauf in docs/TRAININGSLOGIK.md.
import { AREAS, MODES, areaIndex } from "./categories.js";
import { addDays, atTime, daysBetween, startOfDay } from "./dates.js";
import { level as difficultyLevel } from "./difficulty.js";
import { seed, stations } from "./challenge.js";
import * as Tournament from "./tournament.js";
import { normalized, weights as focusWeights } from "./weighting.js";

const TIME_STEP = 5;

export const SETTINGS = {
  warmUpMinutes: 10,
  /** Ab dieser Dauer beginnt eine Einheit mit dem Aufwärmen. */
  warmUpThreshold: 45,
  minimumBlockMinutes: 15,
  maximumBlockMinutes: 60,
  /** Pro angefangene 35 Minuten wird ein Bereich trainiert. */
  minutesPerArea: 35,
  benchmarkIntervalDays: 28,
  /** So weit zurück zählt, was in den Bereichen schon geübt wurde. */
  carryOverDays: 28,
};

export function isPossible(drill, facilities) {
  return (drill.facilities ?? []).every((facility) => facilities.includes(facility));
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Eine behaltene Einheit gehört zu ihrem Golftag, nicht zu Dauer oder Anlagen:
 * Die ändern sich mit jeder Änderung der Golfwoche, die Einheit soll trotzdem
 * bleiben, wie sie war, samt ihrer Häkchen. Wie `belongs` in TrainingPlanner.swift.
 */
function belongs(keep, plan) {
  return keep.slot.id === plan.slot.id && startOfDay(keep.date).getTime() === startOfDay(plan.date).getTime();
}

export class Planner {
  constructor(library) {
    this.library = library;
    this.byID = new Map(library.map((drill) => [drill.id, drill]));
    this.warmUpDrill = library.find((drill) => drill.isWarmUp) ?? null;
  }

  /**
   * Plan für die Woche ab `weekStart`. `kept`: Einheiten, die bleiben, wie sie
   * sind, z. B. beim Neuplanen die vergangenen. Sie zählen für den Ausgleich mit.
   */
  planWeek({ weekStart, slots, rounds = [], focus = [], results = [], tournaments = [], kept = [], now = null }) {
    const weights = focusWeights(rounds, focus);
    const ordered = [...slots].sort(
      (a, b) => a.weekday - b.weekday || a.startHour - b.startHour || a.startMinute - b.startMinute,
    );
    const required = ordered.filter((slot) => !slot.isOptional);
    const optional = ordered.filter((slot) => slot.isOptional);

    const activeFocus = focus.filter((point) => point.isActive);
    const lastDone = new Map();
    for (const result of results) {
      const previous = lastDone.get(result.drillID);
      if (!previous || result.date > previous) lastDone.set(result.drillID, result.date);
    }
    const context = {
      results,
      lastDone,
      focus: activeFocus,
      linkedDrills: new Set(activeFocus.flatMap((point) => point.drillIDs ?? [])),
      usedThisWeek: new Set(),
      scheduledBenchmarks: new Set(),
      modeCount: {},
    };

    const assigned = { normal: {}, tournament: {} };
    const sessions = [];
    const reachable = new Set(ordered.flatMap((slot) => [...this.feasibleAreas(slot)]));
    const carry = this.carryOver(weights, results, weekStart, reachable);

    const prepared = [required, optional].map((group) =>
      group.map((slot) => this.prepare(slot, weekStart, weights, tournaments)).filter(Boolean),
    );
    // Bleibt die Einheit, wie sie war, zählt sie trotzdem für den Ausgleich.
    const adopt = (keep, pool) => {
      for (const [area, minutes] of Object.entries(keep.areaMinutes)) {
        assigned[pool][area] = (assigned[pool][area] ?? 0) + minutes;
      }
      this.note(keep, context);
      sessions.push(keep);
    };
    // Behaltene Einheiten, deren Tag nicht mehr geplant wird, z. B. weil der
    // Golftag abgeschaltet wurde oder jetzt ein Turniertag ist, bleiben
    // ebenfalls und zählen vorab für den Ausgleich der übrigen.
    const remainingKept = [];
    for (const keep of kept) {
      if (prepared.flat().some((plan) => belongs(keep, plan))) {
        remainingKept.push(keep);
      } else {
        adopt(keep, keep.tournament ? "tournament" : "normal");
      }
    }

    const planned = [];
    for (const plans of prepared) {
      planned.push(...plans);
      for (const plan of plans) {
        const pool = plan.tournament ? "tournament" : "normal";
        const index = remainingKept.findIndex((keep) => belongs(keep, plan));
        if (index >= 0) {
          adopt(remainingKept.splice(index, 1)[0], pool);
          continue;
        }

        let deficits;
        if (plan.isDayBefore) {
          deficits = {};
          for (const [area, weight] of Object.entries(plan.weights)) deficits[area] = weight * plan.trainingMinutes;
        } else {
          const targets = this.targetMinutes(planned.filter((other) => other.pool === plan.pool && !other.isDayBefore));
          const done = assigned[pool];
          const behind = plan.isNormal ? carry : {};
          deficits = {};
          for (const [area, target] of Object.entries(targets)) {
            deficits[area] = target - (done[area] ?? 0) + (behind[area] ?? 0);
          }
        }
        const feasible = this.feasibleAreas(plan.slot);
        const weighted = new Set([...feasible].filter((area) => (plan.weights[area] ?? 0) > 0));
        const allocation = this.allocate(
          plan.trainingMinutes,
          deficits,
          weighted.size === 0 ? feasible : weighted,
          plan.isDayBefore ? Tournament.DAY_BEFORE_MINUTES_PER_AREA : SETTINGS.minutesPerArea,
        );
        for (const [area, minutes] of Object.entries(allocation)) {
          assigned[pool][area] = (assigned[pool][area] ?? 0) + minutes;
        }
        sessions.push(this.composeSession(plan, allocation, context));
      }
    }

    sessions.sort((a, b) => a.date - b.date);
    return { weekStart, sessions, weights, createdAt: now };
  }

  note(session, context) {
    for (const planned of session.drills) {
      context.usedThisWeek.add(planned.drillID);
      const drill = this.byID.get(planned.drillID);
      if (!drill || drill.isWarmUp) continue;
      if (drill.isBenchmark) context.scheduledBenchmarks.add(drill.id);
      this.countMode(context, drill.area, drill.mode);
    }
  }

  countMode(context, area, mode) {
    context.modeCount[area] ??= {};
    context.modeCount[area][mode] = (context.modeCount[area][mode] ?? 0) + 1;
  }

  /** Wie weit die Bereiche in den vier Wochen davor hinter ihrem Anteil zurückliegen, in Minuten. */
  carryOver(weights, results, weekStart, reachable) {
    const start = addDays(weekStart, -SETTINGS.carryOverDays);
    const history = {};
    for (const result of results) {
      if (!(result.date >= start && result.date < weekStart)) continue;
      const drill = this.byID.get(result.drillID);
      if (!drill || drill.isWarmUp || !reachable.has(drill.area)) continue;
      history[drill.area] = (history[drill.area] ?? 0) + drill.minutes;
    }
    const total = sum(Object.values(history));
    if (!(total > 0)) return {};
    const filtered = {};
    for (const [area, weight] of Object.entries(weights)) {
      if (reachable.has(area)) filtered[area] = weight;
    }
    const share = normalized(filtered);
    const result = {};
    for (const [area, value] of Object.entries(share)) result[area] = value * total - (history[area] ?? 0);
    return result;
  }

  /** Datum, Dauer, Gewichte und Regeln einer Einheit. null am Turniertag. */
  prepare(slot, weekStart, weights, tournaments) {
    const day = addDays(weekStart, Math.max(1, Math.min(7, slot.weekday)) - 1);
    const date = atTime(day, slot.startHour, slot.startMinute);
    let duration = slot.durationMinutes;
    let slotWeights = weights;
    let modes = [...MODES];
    const tournament = Tournament.context(date, tournaments);
    if (tournament) {
      const rules = Tournament.rules(tournament.phase);
      if (!rules.trains) return null;
      duration = Math.min(duration, rules.maxSessionMinutes ?? duration);
      slotWeights = tournament.phase === "dayBefore" ? Tournament.DAY_BEFORE_WEIGHTS : Tournament.blendedWeights(weights);
      modes = rules.modes;
    }
    const hasWarmUp =
      this.warmUpDrill !== null && isPossible(this.warmUpDrill, slot.facilities) && duration >= SETTINGS.warmUpThreshold;
    return {
      slot,
      date,
      durationMinutes: duration,
      hasWarmUp,
      trainingMinutes: Math.max(0, duration - (hasWarmUp ? SETTINGS.warmUpMinutes : 0)),
      weights: slotWeights,
      modes,
      tournament,
      isNormal: !tournament,
      isDayBefore: tournament?.phase === "dayBefore",
      pool: tournament ? "tournament" : "normal",
    };
  }

  feasibleAreas(slot) {
    const areas = new Set();
    for (const drill of this.library) {
      if (!drill.isWarmUp && isPossible(drill, slot.facilities)) areas.add(drill.area);
    }
    return areas;
  }

  /** Zielminuten je Bereich. Bereiche, die nirgends gehen, geben ihren Anteil ab. */
  targetMinutes(plans) {
    const reachable = new Set(plans.flatMap((plan) => [...this.feasibleAreas(plan.slot)]));
    const targets = {};
    for (const plan of plans) {
      const filtered = {};
      for (const [area, weight] of Object.entries(plan.weights)) {
        if (reachable.has(area)) filtered[area] = weight;
      }
      for (const [area, weight] of Object.entries(normalized(filtered))) {
        targets[area] = (targets[area] ?? 0) + weight * plan.trainingMinutes;
      }
    }
    return targets;
  }

  /** Verteilt die Minuten in 5-Minuten-Schritten auf die Bereiche mit dem größten Rückstand. */
  allocate(total, deficits, feasible, minutesPerArea = SETTINGS.minutesPerArea) {
    if (total <= 0 || feasible.size === 0) return {};
    const ranksHigher = (lhs, rhs, values) => {
      const left = values[lhs] ?? 0;
      const right = values[rhs] ?? 0;
      return left !== right ? left > right : areaIndex(lhs) < areaIndex(rhs);
    };
    const compare = (values) => (a, b) => (ranksHigher(a, b, values) ? -1 : ranksHigher(b, a, values) ? 1 : 0);

    const areaCount = Math.max(1, Math.min(feasible.size, Math.floor(total / minutesPerArea)));
    let chosen = [...feasible].sort(compare(deficits)).slice(0, areaCount);

    while (true) {
      const remaining = { ...deficits };
      const allocation = {};
      let left = total;
      while (left >= TIME_STEP) {
        const open = chosen.filter((area) => (allocation[area] ?? 0) + TIME_STEP <= SETTINGS.maximumBlockMinutes);
        const pool = open.length === 0 ? chosen : open;
        let next = pool[0];
        for (const area of pool.slice(1)) {
          if (ranksHigher(area, next, remaining)) next = area;
        }
        allocation[next] = (allocation[next] ?? 0) + TIME_STEP;
        remaining[next] = (remaining[next] ?? 0) - TIME_STEP;
        left -= TIME_STEP;
      }
      if (left > 0) {
        let biggest = chosen[0];
        for (const area of chosen.slice(1)) {
          if ((allocation[biggest] ?? 0) < (allocation[area] ?? 0)) biggest = area;
        }
        if (biggest !== undefined) allocation[biggest] = (allocation[biggest] ?? 0) + left;
      }

      const tooSmall = chosen.filter((area) => (allocation[area] ?? 0) < SETTINGS.minimumBlockMinutes);
      if (chosen.length > 1 && tooSmall.length > 0) {
        let drop = tooSmall[0];
        for (const area of tooSmall.slice(1)) {
          if ((allocation[area] ?? 0) < (allocation[drop] ?? 0)) drop = area;
        }
        chosen = chosen.filter((area) => area !== drop);
        continue;
      }
      const result = {};
      for (const [area, minutes] of Object.entries(allocation)) {
        if (minutes > 0) result[area] = minutes;
      }
      return result;
    }
  }

  composeSession(plan, allocation, context) {
    const drills = [];
    if (plan.hasWarmUp && this.warmUpDrill) {
      drills.push({ drillID: this.warmUpDrill.id, minutes: SETTINGS.warmUpMinutes, level: 0, focusNotes: [], stations: [] });
    }
    const benchmark = { allowed: plan.isNormal };
    for (const area of AREAS) {
      const minutes = allocation[area];
      if (!(minutes > 0)) continue;
      drills.push(...this.composeBlock(area, minutes, plan, benchmark, context));
    }
    return {
      slot: plan.slot,
      date: plan.date,
      drills,
      areaMinutes: allocation,
      tournament: plan.tournament ?? null,
    };
  }

  /** Übungen eines Bereichs: erst ein fälliger Monatstest, dann Technik, variabel, Wettkampf. */
  composeBlock(area, minutes, plan, benchmark, context) {
    const candidates = this.library.filter(
      (drill) =>
        drill.area === area &&
        !drill.isWarmUp &&
        isPossible(drill, plan.slot.facilities) &&
        (!drill.isCorrective || (plan.isNormal && context.linkedDrills.has(drill.id))),
    );
    const focusNotes = plan.isNormal ? context.focus.filter((point) => point.area === area).map((point) => point.text) : [];

    const parts = [];
    let remaining = minutes;

    if (benchmark.allowed) {
      const test = candidates.find(
        (drill) =>
          drill.isBenchmark &&
          drill.minutes <= minutes &&
          !context.scheduledBenchmarks.has(drill.id) &&
          this.isDue(drill, plan.date, context),
      );
      if (test) {
        parts.push({ drill: test, minutes: test.minutes });
        remaining -= test.minutes;
        benchmark.allowed = false;
        context.scheduledBenchmarks.add(test.id);
      }
    }

    // Ein paar Minuten Rest sind Puffer für den Aufbau des Tests.
    if (parts.length > 0 && remaining < 10) {
      parts[parts.length - 1].minutes += remaining;
      remaining = 0;
    }

    const regular = candidates.filter((drill) => !drill.isBenchmark && plan.modes.includes(drill.mode));
    const modes = this.modePlan(remaining, area, focusNotes.length > 0, context).map((mode) =>
      plan.modes.includes(mode) ? mode : "variable",
    );
    const chosenIDs = new Set(parts.map((part) => part.drill.id));
    const picked = [];
    for (const mode of modes) {
      const drill = this.pick(mode, regular, chosenIDs, !plan.isNormal, context);
      if (!drill) continue;
      chosenIDs.add(drill.id);
      picked.push(drill);
      this.countMode(context, area, drill.mode);
    }

    if (picked.length === 0) {
      if (parts.length > 0) parts[parts.length - 1].minutes += remaining;
    } else {
      const split = this.splitMinutes(remaining, picked.map((drill) => drill.minutes));
      picked.forEach((drill, index) => parts.push({ drill, minutes: split[index] }));
    }

    let focusTarget = parts.findIndex((part) => part.drill.mode === "block");
    if (focusTarget < 0) focusTarget = parts.length > 0 ? 0 : -1;
    return parts.map((part, index) => {
      context.usedThisWeek.add(part.drill.id);
      const level = difficultyLevel(part.drill, context.results);
      const generated = part.drill.generator
        ? stations(part.drill.generator, part.drill.scoring?.attempts ?? 0, level, seed(part.drill.id, plan.date))
        : [];
      return {
        drillID: part.drill.id,
        minutes: part.minutes,
        level,
        focusNotes: index === focusTarget ? focusNotes : [],
        stations: generated,
      };
    });
  }

  /** Mit Schwerpunkt beginnt der Block mit Technik, sonst wechseln Technik und variabel. */
  modePlan(minutes, area, hasFocus, context) {
    const counts = context.modeCount[area] ?? {};
    const opener = hasFocus || (counts.block ?? 0) < (counts.variable ?? 0) ? "block" : "variable";
    if (minutes >= 50) return ["block", "variable", "competition"];
    if (minutes >= 25) return [opener, "competition"];
    if (minutes >= 1) return [opener];
    return [];
  }

  /** Minuten im Verhältnis der Gewichte in 5-Minuten-Blöcken, Rest an den größten Teil. */
  splitMinutes(total, weights) {
    if (weights.length === 0) return [];
    const weightSum = sum(weights);
    const split = weights.map((weight) => {
      const share = weightSum > 0 ? (total * weight) / weightSum : total / weights.length;
      return Math.max(TIME_STEP, Math.round(share / TIME_STEP) * TIME_STEP);
    });
    let largest = 0;
    for (let index = 1; index < split.length; index += 1) {
      if (split[largest] < split[index]) largest = index;
    }
    split[largest] += total - sum(split);
    return split;
  }

  /** Mit Schwerpunkt verknüpft, für Turniere geeignet, diese Woche noch nicht geplant, am längsten nicht gemacht. */
  pick(mode, drills, excluding, preferTournamentPrep, context) {
    const available = drills.filter((drill) => !excluding.has(drill.id));
    const matching = available.filter((drill) => drill.mode === mode);
    const pool = matching.length === 0 ? available : matching;
    const preference = (drill) => [
      mode === "block" && context.linkedDrills.has(drill.id) ? 0 : 1,
      preferTournamentPrep && drill.isTournamentPrep ? 0 : 1,
      context.usedThisWeek.has(drill.id) ? 1 : 0,
    ];
    let best = null;
    let bestPreference = null;
    for (const drill of pool) {
      const current = preference(drill);
      if (!best) {
        best = drill;
        bestPreference = current;
        continue;
      }
      const order = comparePreference(current, bestPreference);
      if (order < 0) {
        best = drill;
        bestPreference = current;
      } else if (order === 0) {
        const left = context.lastDone.get(drill.id)?.getTime() ?? -Infinity;
        const right = context.lastDone.get(best.id)?.getTime() ?? -Infinity;
        if (left < right) {
          best = drill;
          bestPreference = current;
        }
      }
    }
    return best;
  }

  /** Nach Kalendertagen: vier Wochen nach dem letzten Mal wieder fällig. */
  isDue(benchmark, date, context) {
    const last = context.lastDone.get(benchmark.id);
    if (!last) return true;
    return daysBetween(startOfDay(last), date) >= SETTINGS.benchmarkIntervalDays;
  }
}

function comparePreference(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}
