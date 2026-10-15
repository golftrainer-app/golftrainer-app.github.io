// Wortfilter wie ContentFilter im Kern der App
// (GolfCore/Sources/GolfCore/Team/Moderation.swift): Hält gängige Beleidigungen,
// Drohungen und sexuelle Ausdrücke aus dem Team heraus, bevor sie jemand sieht.
// Kein Filter erkennt alles. Dafür gibt es Melden und Blockieren.

/** Hinweis, wenn ein Text nicht durchgeht. */
export const FILTER_MESSAGE = "Bitte formuliere das freundlicher. Beleidigungen, Drohungen und sexuelle Ausdrücke sind im Team nicht erlaubt.";

/** Höchstens so viel vom gemeldeten Text, damit eine Meldung klein bleibt. */
export const EXCERPT_LIMIT = 1000;

export const REPORT_REASONS = ["insult", "harassment", "inappropriate", "privacy", "spam", "other"];
export const REASON_NAMES = {
  insult: "Beleidigung oder Mobbing",
  harassment: "Belästigung oder Bedrohung",
  inappropriate: "Unangemessene Inhalte",
  privacy: "Verletzt die Privatsphäre",
  spam: "Werbung oder Spam",
  other: "Etwas anderes",
};

export const SUBJECT_NAMES = {
  member: "Mitglied",
  announcement: "Beitrag an der Pinnwand",
  event: "Termin",
  response: "Notiz zu einer Antwort",
  challenge: "Challenge",
  comment: "Nachricht",
  clip: "Video",
};

export function excerpt(text) {
  const trimmed = String(text ?? "").trim();
  if ([...trimmed].length <= EXCERPT_LIMIT) return trimmed;
  return `${[...trimmed].slice(0, EXCERPT_LIMIT).join("")} …`;
}

const REPLACEMENTS = [
  ["ä", "ae"],
  ["ö", "oe"],
  ["ü", "ue"],
  ["ß", "ss"],
];

const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", "@": "a", $: "s", "€": "e" };

/** Zeichen, die schon allein nicht durchgehen: der Mittelfinger (U+1F595). */
const SYMBOLS = ["\u{1F595}"];

/** Wortfolgen, die mit einer Zeitangabe harmlos sind („bring dich um 17 Uhr“). */
const TIME_STATEMENTS = new Set(["bring dich um", "bringe dich um"]);

/** Was nach „um“ eine Uhrzeit ankündigt. Zahlen zählen immer. */
const TIME_WORDS = new Set([
  "uhr", "halb", "viertel", "punkt", "kurz", "gegen", "ca", "circa", "etwa", "spaetestens", "fruehestens",
  "eins", "zwei", "drei", "vier", "fuenf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwoelf",
  "dreizehn", "vierzehn", "fuenfzehn", "sechzehn", "siebzehn", "achtzehn", "neunzehn", "zwanzig",
  "mittag", "mitternacht", "morgen", "heute", "frueh", "morgens", "vormittag", "vormittags",
  "nachmittag", "nachmittags", "abend", "abends", "nach", "vor", "am", "den", "die", "zur", "zum",
]);

/** Teile von Wörtern, die in keinem harmlosen Wort vorkommen. Umlaute ausgeschrieben. */
const STEMS = [
  "arschloch", "arschgeig", "hurensohn", "hurensoehn", "wichser", "wixer", "wixxer",
  "missgeburt", "fotze", "fick", "fuck", "schwuchtel", "schwanzlutsch",
  "vergewaltig", "porno", "judensau",
];

/** Ganze Wörter, die nur allein beleidigen. */
const WORDS = new Set([
  "arsch", "hure", "huren", "nutte", "nutten", "schlampe", "schlampen",
  "bastard", "pisser", "drecksau", "dreckssau",
  "spast", "spasti", "spasten", "spacko", "mongo", "mongos", "titten",
  "neger", "negerin", "nigger", "nigga", "niggas", "kanake", "kanaken", "kanacke",
  "bitch", "bitches", "slut", "whore", "cunt", "pussy", "asshole", "kys",
]);

/** Wortfolgen, z. B. Drohungen. Umlaute ausgeschrieben. */
const PHRASES = [
  "halt die fresse", "halt deine fresse", "halts maul", "halt s maul", "halt dein maul",
  "bring dich um", "bringe dich um", "ich toete dich", "ich kill dich", "ich kille dich",
  "verpiss dich", "verpisst euch", "sieg heil", "heil hitler", "kill yourself",
];

function containsSymbol(text) {
  return SYMBOLS.some((symbol) => text.includes(symbol));
}

/** Kleinbuchstaben ohne Akzente, Umlaute ausgeschrieben oder nur ohne Punkte, ß als ss. */
function plain(text, spellingOutUmlauts) {
  let folded = String(text).toLowerCase();
  for (const [from, to] of REPLACEMENTS) {
    if (spellingOutUmlauts || from === "ß") folded = folded.replaceAll(from, to);
  }
  return folded.normalize("NFD").replace(/\p{M}/gu, "");
}

/** Drei und mehr gleiche Buchstaben werden zu einem. Doppelte bleiben. */
export function collapseRuns(word) {
  let result = "";
  let run = [];
  const flush = () => {
    result += run.length >= 3 ? run[0] : run.join("");
    run = [];
  };
  for (const character of word) {
    if (run.length > 0 && run[run.length - 1] !== character) flush();
    run.push(character);
  }
  flush();
  return result;
}

/** Kleinbuchstaben, Zahlen statt Buchstaben zurückübersetzt, lang gezogene Buchstaben gekürzt, in Wörter zerlegt. */
export function tokens(text, spellingOutUmlauts = true) {
  const letters = [...plain(text, spellingOutUmlauts)].map((character) => LEET[character] ?? character).join("");
  return letters
    .split(/[^\p{L}]+/u)
    .filter(Boolean)
    .map(collapseRuns);
}

/** Zwei Lesarten: Umlaute ausgeschrieben („ae“) und Umlaute nur ohne Punkte („a“). */
function tokenVariants(text) {
  const spelled = tokens(text, true);
  const stripped = tokens(text, false);
  return spelled.join(" ") === stripped.join(" ") ? [spelled] : [spelled, stripped];
}

/** „Ich bring dich um 17 Uhr zum Training“ ist eine Zusage, keine Drohung. */
export function isTimeStatement(phrase, text) {
  const words = plain(text, true)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const phraseTokens = phrase.split(" ");
  if (words.length <= phraseTokens.length) return false;
  let found = false;
  for (let start = 0; start <= words.length - phraseTokens.length; start += 1) {
    if (!phraseTokens.every((token, index) => words[start + index] === token)) continue;
    found = true;
    const next = start + phraseTokens.length;
    // „Ich bring dich um.“ endet mit der Drohung.
    if (next >= words.length) return false;
    const following = words[next];
    if (!(/^\p{N}+$/u.test(following) || TIME_WORDS.has(following))) return false;
  }
  return found;
}

function allowsOne(text) {
  const value = String(text ?? "");
  if (containsSymbol(value)) return false;
  for (const list of tokenVariants(value)) {
    if (list.length === 0) continue;
    for (const token of list) {
      if (WORDS.has(token)) return false;
      if (STEMS.some((stem) => token.includes(stem))) return false;
    }
    const joined = ` ${list.join(" ")} `;
    for (const phrase of PHRASES) {
      if (!joined.includes(` ${phrase} `)) continue;
      if (TIME_STATEMENTS.has(phrase) && isTimeStatement(phrase, value)) continue;
      return false;
    }
  }
  return true;
}

/** `true`, wenn keiner der Texte etwas enthält, das der Filter kennt. */
export function allows(...texts) {
  return texts.flat().every(allowsOne);
}

/** Für Namen: nur ganze Wörter. Nachnamen wie Ficker enthalten einen Stamm, sind aber keine Beleidigung. */
export function allowsName(name) {
  const value = String(name ?? "");
  if (containsSymbol(value)) return false;
  for (const list of tokenVariants(value)) {
    for (const token of list) {
      if (WORDS.has(token) || STEMS.includes(token)) return false;
    }
  }
  return true;
}
