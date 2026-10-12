// Mehr → Konto: Anmelden, Konto erstellen, E-Mail bestätigen, Passwort
// vergessen, Abmelden und Konto löschen, wie AccountView in der App. Die Daten
// in diesem Browser bleiben in jedem Fall.
import { formatShortDate, formatTime } from "../core/dates.js";
import { MINIMUM_PASSWORD_LENGTH } from "../supabase.js";
import { ask, chapter, html, inform, toast } from "../ui.js";

/** Eingaben bleiben beim Neuzeichnen der Seite, z. B. während eine Anfrage läuft. Passwörter nur im Speicher, nie im HTML. */
const form = { mode: "signIn", email: "", password: "", repeated: "", underSixteen: false, consent: false, message: null };

function note(message) {
  if (!message) return "";
  return html`<p class="hint${message.isProblem ? " problem" : ""}">${message.text}</p>`;
}

/** „Nicht angemeldet“, „E-Mail bestätigen“ oder die E-Mail-Adresse, für die Zeile unter „Mehr“. */
export function accountStatusText(account) {
  switch (account.status) {
    case "signedIn":
      return account.email;
    case "awaitingConfirmation":
      return "E-Mail bestätigen";
    default:
      return "Nicht angemeldet";
  }
}

function syncedText(account) {
  const at = account.lastSyncAt;
  return at ? `Zuletzt abgeglichen ${formatShortDate(at)}, ${formatTime(at)} Uhr.` : "Noch nicht abgeglichen.";
}

/** Fußzeile des Kapitels „Konto“ unter „Mehr“, wie AccountChapter in der App. */
export function accountFooter(account) {
  if (account.status === "signedIn") return account.syncProblem ?? syncedText(account);
  return "Freiwillig. Mit Konto gleichen iPhone, iPad und die Web-App deine Daten ab. Ohne Konto bleibt alles in diesem Browser.";
}

function canSubmit() {
  const address = form.email.trim();
  if (!address.includes("@") || !address.includes(".") || !form.password) return false;
  if (form.mode === "signIn") return true;
  return form.password.length >= MINIMUM_PASSWORD_LENGTH && form.repeated === form.password && (!form.underSixteen || form.consent);
}

// MARK: - Nicht angemeldet

function signedOut(account) {
  const isSignIn = form.mode === "signIn";
  return html`${chapter(
    isSignIn ? "Anmelden" : "Konto erstellen",
    html`<div class="choice" role="group" aria-label="Anmelden oder Konto erstellen">
        <button type="button" data-mode="signIn" aria-pressed="${String(isSignIn)}">Anmelden</button>
        <button type="button" data-mode="signUp" aria-pressed="${String(!isSignIn)}">Konto erstellen</button>
      </div>
      <form class="editor" novalidate data-account>
        <label class="field"><span>E-Mail-Adresse</span><input type="email" name="email" value="${form.email}" autocomplete="email" autocapitalize="none" spellcheck="false" inputmode="email" data-key="email"></label>
        <label class="field"><span>${isSignIn ? "Passwort" : `Passwort, mindestens ${MINIMUM_PASSWORD_LENGTH} Zeichen`}</span><input type="password" name="password" autocomplete="${isSignIn ? "current-password" : "new-password"}" data-key="password"></label>
        ${isSignIn
          ? ""
          : html`<label class="field"><span>Passwort wiederholen</span><input type="password" name="repeated" autocomplete="new-password" data-key="repeated"></label>
              <label class="toggle"><span>Ich bin unter 16</span><input type="checkbox" name="underSixteen" ${form.underSixteen ? "checked" : ""} data-key="under16"></label>
              ${form.underSixteen
                ? html`<label class="toggle"><span>Ein Elternteil ist einverstanden</span><input type="checkbox" name="consent" ${form.consent ? "checked" : ""} data-key="consent"></label>
                    <p class="note">Unter 16 braucht ein Konto das Einverständnis eines Elternteils (Art. 8 DSGVO). Zeig ihm vorher die Datenschutzerklärung unter Mehr → Datenschutz und Rechtliches.</p>`
                : ""}`}
        <div class="buttons">
          <button type="submit" class="button flag wide" data-submit ${canSubmit() && !account.isBusy ? "" : "disabled"}>${account.isBusy ? "Bitte warten …" : isSignIn ? "Anmelden" : "Konto erstellen"}</button>
        </div>
        ${isSignIn ? html`<button type="button" class="action" data-action="recover">Passwort vergessen?<span class="mark">→</span></button>` : ""}
      </form>`,
    {
      footer: isSignIn
        ? "Mit deinem Konto gleichen iPhone, iPad und die Web-App deine Daten ab. Beim ersten Anmelden kommen die Daten dieses Browsers und die des Kontos zusammen, nichts geht verloren."
        : "Du bekommst eine E-Mail mit einem Link zum Bestätigen. Öffnet er diese Seite, bist du gleich angemeldet. Abgeglichen werden Golfwoche, Vorschläge, Ergebnisse, Tagebuch, Runden, Turniere, Schwerpunkte und Launch-Monitor-Daten. Der Server steht in Frankfurt, siehe Datenschutzerklärung.",
    },
  )}
  ${note(form.message)}`;
}

// MARK: - E-Mail bestätigen

function awaiting(account) {
  return html`${chapter(
    "E-Mail bestätigen",
    html`<p class="serif">Wir haben eine E-Mail an ${account.email} geschickt. Tippe auf den Link darin. Öffnet er diese Seite, bist du gleich angemeldet. Sonst melde dich hier an. Sieh auch im Spam-Ordner nach.</p>
      <button type="button" class="action" data-action="resend" ${account.isBusy ? "disabled" : ""}>E-Mail noch einmal schicken<span class="mark">↗</span></button>
      <button type="button" class="action" data-action="confirmed">Bestätigt, jetzt anmelden<span class="mark">→</span></button>
      <button type="button" class="action" data-action="other">Andere E-Mail-Adresse<span class="mark">→</span></button>`,
  )}
  ${note(form.message)}`;
}

// MARK: - Angemeldet

function signedIn(account) {
  return html`${chapter(
    "Konto",
    html`<ul class="rows">
        <li class="row labeled"><span class="row-main">Angemeldet als</span><span class="row-value">${account.email}</span></li>
        <li class="row labeled"><span class="row-main">Abgleich</span><span class="row-value">${account.isSyncing ? "läuft …" : account.lastSyncAt ? `${formatShortDate(account.lastSyncAt)}, ${formatTime(account.lastSyncAt)} Uhr` : "noch nicht"}</span></li>
      </ul>
      ${account.syncProblem ? html`<p class="hint problem">${account.syncProblem}</p>` : ""}
      <button type="button" class="action" data-action="sync" ${account.isSyncing ? "disabled" : ""}>Jetzt abgleichen<span class="mark">↻</span></button>`,
    {
      footer:
        "Abgeglichen werden Golfwoche, Vorschläge, Ergebnisse, Tagebuch, Runden, Turniere, Schwerpunkte und Launch-Monitor-Daten. Was nur die App kennt, z. B. die Werte der Schwunganalysen, reicht die Web-App unverändert weiter. Der Abgleich läuft beim Öffnen der Seite und kurz nach jeder Änderung.",
    },
  )}
  ${chapter(
    "",
    html`<button type="button" class="action" data-action="signout" ${account.isBusy ? "disabled" : ""}>Abmelden<span class="mark">→</span></button>
      <button type="button" class="action danger" data-action="delete" ${account.isBusy ? "disabled" : ""}>Konto löschen</button>`,
    { footer: "Abmelden lässt deine Daten in diesem Browser. Konto löschen entfernt Konto, Profil und Daten auf dem Server, die Daten in diesem Browser bleiben." },
  )}
  ${note(form.message)}`;
}

// MARK: - Seite

export function accountPage(app) {
  const { account } = app;
  const linkMessage = account.takeLinkMessage();
  if (linkMessage) form.message = { text: linkMessage, isProblem: true };
  return {
    title: "Konto",
    tab: "mehr",
    parent: "#/mehr",
    render() {
      switch (account.status) {
        case "signedIn":
          return signedIn(account);
        case "awaitingConfirmation":
          return awaiting(account);
        default:
          return signedOut(account);
      }
    },
    mount(root) {
      const formElement = root.querySelector("form[data-account]");
      if (formElement) {
        formElement.elements.password.value = form.password;
        if (formElement.elements.repeated) formElement.elements.repeated.value = form.repeated;
        const update = () => {
          form.email = formElement.elements.email.value;
          form.password = formElement.elements.password.value;
          form.repeated = formElement.elements.repeated?.value ?? "";
          form.underSixteen = formElement.elements.underSixteen?.checked ?? false;
          form.consent = formElement.elements.consent?.checked ?? false;
          root.querySelector("[data-submit]").disabled = !canSubmit() || account.isBusy;
        };
        formElement.addEventListener("input", update);
        formElement.addEventListener("change", (event) => {
          update();
          // Der zweite Schalter erscheint erst mit dem ersten.
          if (event.target.name === "underSixteen") app.render({ keepScroll: true });
        });
        formElement.addEventListener("submit", async (event) => {
          event.preventDefault();
          update();
          if (!canSubmit() || account.isBusy) return;
          form.message = null;
          const message =
            form.mode === "signIn"
              ? await account.signIn({ email: form.email, password: form.password })
              : await account.signUp({ email: form.email, password: form.password, underSixteen: form.underSixteen, parentalConsent: form.consent });
          if (message) {
            form.message = { text: message, isProblem: true };
          } else {
            form.password = "";
            form.repeated = "";
            if (account.status === "signedIn") toast("Angemeldet. Der Abgleich läuft.");
          }
          app.render({ keepScroll: true });
        });
      }
      root.addEventListener("click", async (event) => {
        const modeButton = event.target.closest("[data-mode]");
        if (modeButton) {
          form.mode = modeButton.dataset.mode;
          form.message = null;
          app.render({ keepScroll: true });
          return;
        }
        const button = event.target.closest("[data-action]");
        if (!button || account.isBusy) return;
        switch (button.dataset.action) {
          case "recover": {
            const email = form.email.trim();
            if (!email.includes("@")) {
              form.message = { text: "Trag oben deine E-Mail-Adresse ein, dann schicken wir dir einen Link.", isProblem: true };
              app.render({ keepScroll: true });
              return;
            }
            const choice = await ask({ title: "Passwort zurücksetzen?", message: `Wir schicken einen Link an ${email}. Öffne ihn auf diesem Gerät, dann kannst du ein neues Passwort wählen.`, actions: [{ label: "Link schicken", value: "send", style: "flag" }] });
            if (choice !== "send") return;
            const problem = await account.recover(email);
            form.message = problem ? { text: problem, isProblem: true } : { text: "Wenn es ein Konto mit dieser E-Mail-Adresse gibt, ist ein Link unterwegs.", isProblem: false };
            app.render({ keepScroll: true });
            return;
          }
          case "resend": {
            const problem = await account.resendConfirmation(account.email);
            form.message = problem ? { text: problem, isProblem: true } : { text: "Die E-Mail ist noch einmal unterwegs.", isProblem: false };
            app.render({ keepScroll: true });
            return;
          }
          case "confirmed":
            form.email = account.email;
            form.mode = "signIn";
            form.message = null;
            account.cancelConfirmation();
            return;
          case "other":
            form.email = "";
            form.mode = "signUp";
            form.message = null;
            account.cancelConfirmation();
            return;
          case "sync":
            form.message = null;
            account.sync();
            return;
          case "signout": {
            const choice = await ask({ title: "Abmelden?", message: "Deine Daten bleiben in diesem Browser. Der Abgleich hört auf, bis du dich wieder anmeldest.", actions: [{ label: "Abmelden", value: "signout", style: "flag" }] });
            if (choice !== "signout") return;
            form.message = null;
            await account.signOut();
            toast("Abgemeldet. Deine Daten bleiben in diesem Browser.");
            return;
          }
          case "delete": {
            const choice = await ask({
              title: "Konto löschen?",
              message: "Das lässt sich nicht rückgängig machen. Die Daten in diesem Browser bleiben, bis du sie unter „Meine Daten löschen“ entfernst.",
              actions: [{ label: "Konto und Daten auf dem Server löschen", value: "delete", style: "danger" }],
            });
            if (choice !== "delete") return;
            const problem = await account.deleteAccount();
            form.message = problem ? { text: problem, isProblem: true } : null;
            if (!problem) await inform("Konto gelöscht", "Dein Konto ist gelöscht. Die Daten in diesem Browser bleiben.");
            app.render({ keepScroll: true });
            return;
          }
          default:
            return;
        }
      });
    },
  };
}

// MARK: - Neues Passwort

/** Nach dem Link „Passwort zurücksetzen“: Der Link bringt die Sitzung mit, hier kommt das neue Passwort. */
export function passwordPage(app) {
  const { account } = app;
  let message = null;
  return {
    title: "Neues Passwort",
    tab: "mehr",
    parent: "#/mehr/konto",
    keepOnChange: true,
    render() {
      if (account.status !== "signedIn") {
        return html`${chapter(
          "Neues Passwort",
          html`<p class="serif">Öffne den Link aus der E-Mail „Passwort zurücksetzen“ auf diesem Gerät. Dann kannst du hier ein neues Passwort wählen.</p>
            <a class="button outline" href="#/mehr/konto">Zum Konto</a>`,
        )}`;
      }
      return html`${chapter(
        "Neues Passwort",
        html`<form class="editor" novalidate data-password>
          <label class="field"><span>Neues Passwort, mindestens ${MINIMUM_PASSWORD_LENGTH} Zeichen</span><input type="password" name="password" autocomplete="new-password" data-key="password"></label>
          <label class="field"><span>Passwort wiederholen</span><input type="password" name="repeated" autocomplete="new-password" data-key="repeated"></label>
          <div class="buttons"><button type="submit" class="button flag wide" data-submit disabled>Passwort sichern</button></div>
        </form>`,
        { footer: `Für ${account.email}. Danach bist du hier angemeldet, auf anderen Geräten meldest du dich mit dem neuen Passwort an.` },
      )}
      ${note(message)}`;
    },
    mount(root) {
      const formElement = root.querySelector("form[data-password]");
      if (!formElement) return;
      const submit = root.querySelector("[data-submit]");
      const update = () => {
        const password = formElement.elements.password.value;
        submit.disabled = password.length < MINIMUM_PASSWORD_LENGTH || formElement.elements.repeated.value !== password || account.isBusy;
      };
      formElement.addEventListener("input", update);
      formElement.addEventListener("submit", async (event) => {
        event.preventDefault();
        update();
        if (submit.disabled) return;
        submit.disabled = true;
        const problem = await account.updatePassword(formElement.elements.password.value);
        if (problem) {
          message = { text: problem, isProblem: true };
          app.render({ keepScroll: true });
          return;
        }
        toast("Neues Passwort gesichert.");
        app.navigate("#/mehr/konto", { replace: true });
      });
    },
  };
}
