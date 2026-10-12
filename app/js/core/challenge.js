// Ansagen für Übungen, bei denen die App jeden Ball vorgibt, z. B. zufällige
// Distanzen. Genau wie ChallengeGenerator in der App: derselbe Startwert aus
// Übung und Tag, derselbe Zufallsgenerator (SplitMix64) und dieselben
// Verfahren wie Swift für Zufallszahlen und Mischen. Deshalb mit BigInt.
import { utcDayNumber } from "./dates.js";

const MASK = (1n << 64n) - 1n;

export class SplitMix64 {
  constructor(seed) {
    this.state = BigInt.asUintN(64, seed);
  }

  next() {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & MASK;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
    return z ^ (z >> 31n);
  }

  /** Zahl von 0 bis `upperBound - 1`, Lemires Verfahren wie `next(upperBound:)` in Swift. */
  nextBelow(upperBound) {
    const bound = BigInt(upperBound);
    let product = this.next() * bound;
    if ((product & MASK) < bound) {
      const threshold = ((MASK + 1n - bound) & MASK) % bound;
      while ((product & MASK) < threshold) {
        product = this.next() * bound;
      }
    }
    return Number(product >> 64n);
  }

  /** Wie `randomElement(using:)`. */
  element(list) {
    return list[this.nextBelow(list.length)];
  }

  /** Wie `shuffled(using:)`: Fisher-Yates von vorne. */
  shuffled(list) {
    const result = [...list];
    let amount = result.length;
    let index = 0;
    while (amount > 1) {
      const offset = this.nextBelow(amount);
      amount -= 1;
      [result[index], result[index + offset]] = [result[index + offset], result[index]];
      index += 1;
    }
    return result;
  }
}

/** Stabiler Startwert aus Übung und Tag (FNV-1a über die UTF-8-Bytes der Kennung). */
export function seed(drillID, date) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(drillID)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & MASK;
  }
  return hash ^ BigInt.asUintN(64, BigInt(utcDayNumber(date)));
}

function strideThrough(from, through, by) {
  const values = [];
  for (let value = from; value <= through; value += by) values.push(value);
  return values;
}

function balanced(values, count, rng) {
  const pool = Array.from({ length: count }, (_, index) => values[index % values.length]);
  return rng.shuffled(pool);
}

function repeated(values, count) {
  return Array.from({ length: count }, (_, index) => values[index % values.length]);
}

export function stations(kind, count, level, seedValue) {
  if (count <= 0) return [];
  const rng = new SplitMix64(seedValue);
  switch (kind) {
    case "wedgeDistances": {
      const range = level === 0 ? strideThrough(40, 80, 5) : level === 1 ? strideThrough(35, 95, 5) : strideThrough(30, 100, 5);
      return Array.from({ length: count }, () => `${rng.element(range)} m`);
    }
    case "wedgeTest":
      return balanced([40, 55, 70, 85], count, rng).map((value) => `${value} m`);
    case "ironTest":
      return balanced([110, 130, 150, 170], count, rng).map((value) => `${value} m`);
    case "lagDistances": {
      const distances = level >= 2 ? [9, 12, 15, 18] : [9, 12, 15];
      return Array.from({ length: count }, () => `${rng.element(distances)} m`);
    }
    case "shortGameLies": {
      const allLies = ["Vorgrün", "Fairway", "Leichtes Rough", "Tiefes Rough", "Hang bergauf", "Hang bergab", "Ball über den Füßen"];
      const lies = allLies.slice(0, level === 0 ? 3 : level === 1 ? 5 : allLies.length);
      const distances = [5, 8, 12, 15, 20, 25];
      return Array.from({ length: count }, () => {
        const lie = rng.element(lies);
        return `${lie} · ${rng.element(distances)} m`;
      });
    }
    case "nineWindows": {
      const heights = ["Hoch", "Mittel", "Flach"];
      if (level === 0) return repeated(heights.flatMap((height) => [height, height, height]), count);
      const windows = heights.flatMap((height) => ["Fade", "Gerade", "Draw"].map((shape) => `${height} · ${shape}`));
      return repeated(level === 1 ? windows : rng.shuffled(windows), count);
    }
    case "puttTest": {
      const list = ["1 m", "2 m", "4–6 m", "10–15 m"];
      return repeated(list.flatMap((value) => Array(5).fill(value)), count);
    }
    case "shortGameTest": {
      const list = [
        "Pitch 45 m",
        "Pitch 27 m",
        "Chip aus dem Rough 18 m",
        "Lob 14 m",
        "Bunker 9 m",
        "Bunker 14 m",
        "Chip vom Vorgrün 9 m",
        "Chip aus dem Rough 14 m",
      ];
      return repeated(list.flatMap((value) => Array(5).fill(value)), count);
    }
    default:
      return [];
  }
}
