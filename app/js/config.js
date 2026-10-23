// Adresse und öffentlicher Schlüssel des Supabase-Projekts für das Konto,
// dieselben wie in GolfCore/Sources/GolfCore/Resources/supabase.json
// (test/supabase.test.mjs prüft das). Der Schlüssel „anon“ ist öffentlich und
// für Apps gedacht: Er erlaubt Registrieren und Anmelden. Daten gibt es nur
// mit angemeldeter Sitzung, jeder nur seine eigenen (docs/KONTO.md).
/**
 * Version der Web-App, dieselbe wie VERSION in sw.js (test/sw.test.mjs prüft
 * das). Das Team merkt sich damit, ob es nach einem Update Einträge noch
 * einmal holen muss, die die alte Version nicht lesen konnte.
 */
export const APP_VERSION = "2026-10-23-2";

export const SUPABASE = {
  url: "https://vdzydvydngpmxpmarjdb.supabase.co",
  anonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkenlkdnlkbmdwbXhwbWFyamRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3ODcxNzEsImV4cCI6MjEwNzM2MzE3MX0.dhWnRtzCA1bZJicaoAc_uPDmIDVjNylFlMWno-H8PWw",
};
