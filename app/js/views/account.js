// Mehr → Konto: Anmelden, Konto erstellen, E-Mail bestätigen, Passwort
// vergessen, Passwort ändern, Abmelden und Konto löschen, wie AccountView in
// der App. Die Daten in diesem Browser bleiben in jedem Fall.
import { formatShortDate, formatTime } from "../core/dates.js";
import { MINIMUM_PASSWORD_LENGTH } from "../supabase.js";
import { ask, chapter, html, inform, toast } from "../ui.js";

/**
 * Eingaben bleiben beim Neuzeichnen der Seite, z. B. während eine Anfrage
 * läuft. Passwörter nur im Speicher, nie im HTML, und beim Verlassen der Seite
 * weg. `underSixteen` ist null, bis du es wählst: nichts ist vorausgewählt.
 */
const form = { mode: "signIn", email: "", password: "", repeated: "", underSixteen: null, consent: false, message: null };

const SYNCED = "Abgeglichen werden Golfwoche, Vorschläge, Ergebnisse, Tagebuch, Runden, Turniere, Schwerpunkte, Launch-Monitor-Daten, Spielhand und Nutzung.";

/** Rückmeldung direkt unter dem Knopf. Ein Fehler wird vorgelesen, sobald er erscheint. */
function note(message) {
  if (!message) return "";
  return message.isProblem ? html`<p class="hint problem" role="alert">${message.text}</p>` : html`<p class="hint" role="status">${message.text}</p>`;
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
  if (account.signedOutReason) return `${account.signedOutReason} Deine Daten sind noch in diesem Browser.`;
  return "Freiwillig. Mit Konto gleichen iPhone, iPad und die Web-App deine Daten ab. Ohne Konto bleibt alles in diesem Browser.";
}

function canSubmit() {
  const address = form.email.trim();
  if (!address.includes("@") || !address.includes(".") || !form.password) return false;
  if (form.mode === "signIn") return true;
  if (form.password.length < MINIMUM_PASSWORD_LENGTH || form.repeated !== form.password) return false;
  if (form.underSixteen == null) return false;
  return !form.underSixteen || form.consent;
}

// MARK: - Rückfrage zu einem Link aus einer E-Mail

/**
 * Ein Link, dessen Adresse nicht in diesem Browser registriert wurde, meldet
 * erst nach einer Rückfrage an. Er könnte von jemand anderem stammen, und
 * deine Daten gingen sonst in ein fremdes Konto.
 */
function pendingLink(account) {
  const email = account.pendingLink.session.email;
  const current = account.status === "signedIn" ? html`<p class="serif">Du bist gerade als ${account.email} angemeldet. Mit „Anmelden“ wechselt dieser Browser zu ${email}, und die Daten hier kommen in dieses Konto.</p>` : "";
  return html`${chapter(
    "Anmelden?",
    html`<p class="serif">Der Link gehört zu <strong>${email}</strong>. Als ${email} anmelden? Die Daten dieses Browsers werden dann mit diesem Konto abgeglichen.</p>
      ${current}
      <div class="buttons">
        <button type="button" class="button flag wide" data-action="accept-link">Als ${email} anmelden</button>
        <button type="button" class="button outline wide" data-action="discard-link">Nicht anmelden</button>
      </div>`,
    { footer: "Stammt der Link nicht von dir, tippe auf „Nicht anmelden“. Die E-Mail-Adresse des Links ist trotzdem bestätigt." },
  )}`;
}

// MARK: - Nicht angemeldet

function signedOut(account) {
  const isSignIn = form.mode === "signIn";
  if (!form.email && account.lastEmail) form.email = account.lastEmail;
  const reason = account.signedOutReason ? html`<p class="hint problem" role="alert">${account.signedOutReason} Deine Daten sind noch in diesem Browser.</p>` : "";
  return html`${reason}${chapter(
    isSignIn ? "Anmelden" : "Konto erstellen",
    html`<div class="choice" role="group" aria-label="Anmelden oder Konto erstellen">
        <button type="button" data-mode="signIn" aria-pressed="${String(isSignIn)}">Anmelden</button>
        <button type="button" data-mode="signUp" aria-pressed="${String(!isSignIn)}">Konto erstellen</button>
      </div>
      <form class="editor" novalidate data-account>
        <label class="field"><span>E-Mail-Adresse</span><input type="email" name="email" value="${form.email}" autocomplete="username" autocapitalize="none" spellcheck="false" inputmode="email" data-key="email"></label>
        <label class="field"><span>${isSignIn ? "Passwort" : `Passwort, mindestens ${MINIMUM_PASSWORD_LENGTH} Zeichen`}</span><input type="password" name="password" autocomplete="${isSignIn ? "current-password" : "new-password"}" data-key="password"></label>
        ${isSignIn
          ? ""
          : html`<label class="field"><span>Passwort wiederholen</span><input type="password" name="repeated" autocomplete="new-password" data-key="repeated"></label>
              <div class="choice-block"><p class="kicker">Wie alt bist du?</p>
                <div class="choice" role="group" aria-label="Wie alt bist du?">
                  <button type="button" data-age="under" aria-pressed="${String(form.underSixteen === true)}" data-key="age-under">Unter 16</button>
                  <button type="button" data-age="over" aria-pressed="${String(form.underSixteen === false)}" data-key="age-over">16 oder älter</button>
                </div>
              </div>
              ${form.underSixteen === true
                ? html`<label class="toggle"><span>Ein Elternteil ist einverstanden</span><input type="checkbox" name="consent" ${form.consent ? "checked" : ""} data-key="consent"></label>
                    <p class="note">Unter 16 braucht ein Konto das Einverständnis eines Elternteils (Art. 8 DSGVO). Zeig die Datenschutzerklärung vorher deinen Eltern, unter Mehr → Datenschutz und Rechtliches.</p>`
                : ""}`}
        <div class="buttons">
          <button type="submit" class="button flag wide" data-submit data-key="submit" ${canSubmit() && !account.isBusy ? "" : "disabled"}>${account.isBusy ? "Bitte warten …" : isSignIn ? "Anmelden" : "Konto erstellen"}</button>
        </div>
        ${note(form.message)}
        ${isSignIn ? html`<button type="button" class="action" data-action="recover">Passwort vergessen?<span class="mark" aria-hidden="true">→</span></button>` : ""}
      </form>`,
    {
      footer: isSignIn
        ? "Mit deinem Konto gleichen iPhone, iPad und die Web-App deine Daten ab. Beim ersten Anmelden gelten die Einstellungen des Kontos, Einträge beider Seiten kommen zusammen, nichts geht verloren."
        : `Du bekommst eine E-Mail mit einem Link zum Bestätigen. Öffnet er diese Seite, bist du gleich angemeldet. ${SYNCED} Der Server steht in Frankfurt, siehe Datenschutzerklärung.`,
    },
  )}`;
}

// MARK: - E-Mail bestätigen

function awaiting(account) {
  return html`${chapter(
    "E-Mail bestätigen",
    html`<p class="serif">Wir haben eine E-Mail an ${account.email} geschickt. Tippe auf den Link darin. Öffnet er diese Seite, bist du gleich angemeldet. Sonst melde dich hier an. Sieh auch im Spam-Ordner nach.</p>
      <button type="button" class="action" data-action="resend" ${account.isBusy ? "disabled" : ""}>E-Mail noch einmal schicken<span class="mark" aria-hidden="true">↗</span></button>
      <button type="button" class="action" data-action="confirmed">Bestätigt, jetzt anmelden<span class="mark" aria-hidden="true">→</span></button>
      <button type="button" class="action" data-action="other">Andere E-Mail-Adresse<span class="mark" aria-hidden="true">→</span></button>
      ${note(form.message)}`,
  )}`;
}

// MARK: - Angemeldet

function signedIn(account) {
  return html`${chapter(
    "Konto",
    html`<ul class="rows">
        <li class="row labeled"><span class="row-main">Angemeldet als</span><span class="row-value">${account.email}</span></li>
        <li class="row labeled"><span class="row-main">Abgleich</span><span class="row-value">${account.isSyncing ? "läuft …" : account.lastSyncAt ? `${formatShortDate(account.lastSyncAt)}, ${formatTime(account.lastSyncAt)} Uhr` : "noch nicht"}</span></li>
      </ul>
      ${account.syncProblem ? html`<p class="hint problem" role="alert">${account.syncProblem}</p>` : ""}
      <button type="button" class="action" data-action="sync" ${account.isSyncing ? "disabled" : ""}>Jetzt abgleichen<span class="mark" aria-hidden="true">↻</span></button>
      ${note(form.message)}`,
    {
      footer: `${SYNCED} Was nur die App kennt, z. B. die Werte der Schwunganalysen, reicht die Web-App unverändert weiter. Der Abgleich läuft beim Öffnen der Seite, beim Verlassen und kurz nach jeder Änderung.`,
    },
  )}
  ${chapter(
    "",
    html`<a class="action" href="#/mehr/konto/passwort">Passwort ändern<span class="mark" aria-hidden="true">›</span></a>
      <button type="button" class="action" data-action="signout" ${account.isBusy ? "disabled" : ""}>Abmelden<span class="mark" aria-hidden="true">→</span></button>
      <button type="button" class="action danger" data-action="delete" ${account.isBusy ? "disabled" : ""}>Konto löschen</button>`,
    { footer: "Abmelden meldet nur diesen Browser ab, deine Daten bleiben hier. Konto löschen entfernt Konto, Profil und Daten auf dem Server, die Daten in diesem Browser bleiben." },
  )}`;
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
      const question = account.pendingLink ? pendingLink(account) : "";
      switch (account.status) {
        case "signedIn":
          return html`${question}${signedIn(account)}`;
        case "awaitingConfirmation":
          return html`${question}${awaiting(account)}`;
        default:
          return html`${question}${signedOut(account)}`;
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
          form.consent = formElement.elements.consent?.checked ?? false;
          root.querySelector("[data-submit]").disabled = !canSubmit() || account.isBusy;
        };
        formElement.addEventListener("input", update);
        formElement.addEventListener("change", update);
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
        const ageButton = event.target.closest("[data-age]");
        if (ageButton) {
          // Der Schalter zum Einverständnis erscheint erst mit „Unter 16“.
          form.underSixteen = ageButton.dataset.age === "under";
          if (!form.underSixteen) form.consent = false;
          form.message = null;
          app.render({ keepScroll: true });
          return;
        }
        const button = event.target.closest("[data-action]");
        if (!button || account.isBusy) return;
        switch (button.dataset.action) {
          case "accept-link":
            form.message = null;
            await account.acceptPendingLink();
            toast("Angemeldet. Der Abgleich läuft.");
            app.render({ keepScroll: true });
            return;
          case "discard-link":
            account.discardPendingLink();
            app.render({ keepScroll: true });
            return;
          case "recover": {
            const email = form.email.trim();
            if (!email.includes("@")) {
              form.message = { text: "Trag oben deine E-Mail-Adresse ein, dann schicken wir dir einen Link.", isProblem: true };
              app.render({ keepScroll: true });
              return;
            }
            const choice = await ask({ title: "Passwort zurücksetzen?", message: `Wir schicken einen Link an ${email}. Er öffnet diese Seite, dort wählst du ein neues Passwort.`, actions: [{ label: "Link schicken", value: "send", style: "flag" }] });
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
            const choice = await ask({ title: "Abmelden?", message: "Deine Daten bleiben in diesem Browser, andere Geräte bleiben angemeldet. Der Abgleich hört hier auf, bis du dich wieder anmeldest. Meldet sich danach ein anderes Konto an, kommen die Daten dieses Browsers in dieses andere Konto.", actions: [{ label: "Abmelden", value: "signout", style: "flag" }] });
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
      // Beim Verlassen der Seite: Passwörter nicht im Speicher lassen. Beim
      // Neuzeichnen derselben Seite bleiben sie, sonst müsstest du nach jedem
      // Tippen auf einen Schalter neu tippen.
      return () => {
        if (location.hash === "#/mehr/konto") return;
        form.password = "";
        form.repeated = "";
      };
    },
  };
}

// MARK: - Neues Passwort

/**
 * Nach dem Link „Passwort zurücksetzen“ oder angemeldet über „Passwort
 * ändern“. Der Link bringt die Sitzung mit, hier kommt das neue Passwort.
 */
export function passwordPage(app) {
  const { account } = app;
  let message = null;
  return {
    title: account.pendingRecovery ? "Neues Passwort" : "Passwort ändern",
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
        account.pendingRecovery ? "Neues Passwort" : "Passwort ändern",
        html`<form class="editor" novalidate data-password>
          <input type="email" name="username" value="${account.email}" autocomplete="username" hidden aria-hidden="true" tabindex="-1">
          <label class="field"><span>Neues Passwort, mindestens ${MINIMUM_PASSWORD_LENGTH} Zeichen</span><input type="password" name="password" autocomplete="new-password" data-key="password"></label>
          <label class="field"><span>Passwort wiederholen</span><input type="password" name="repeated" autocomplete="new-password" data-key="repeated"></label>
          <div class="buttons"><button type="submit" class="button flag wide" data-submit disabled>Passwort sichern</button></div>
          ${note(message)}
        </form>`,
        {
          footer: account.pendingRecovery
            ? `Für ${account.email}. Danach fragen wir, ob dieser Browser angemeldet bleibt. Auf anderen Geräten meldest du dich mit dem neuen Passwort an.`
            : `Für ${account.email}. Auf anderen Geräten meldest du dich danach mit dem neuen Passwort an.`,
        },
      )}`;
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
        if (account.pendingRecovery) {
          // Auf einem fremden Gerät soll die Anmeldung nicht bleiben.
          const choice = await ask({
            title: "Hier angemeldet bleiben?",
            message: `Das neue Passwort ist gesichert. Bleibt ${account.email} in diesem Browser angemeldet, gleicht die Seite deine Daten ab. Auf einem fremden Gerät wähle „Abmelden“.`,
            actions: [
              { label: "Angemeldet bleiben", value: "stay", style: "flag" },
              { label: "Abmelden", value: "leave", style: "outline" },
            ],
          });
          await account.finishRecovery(choice === "stay");
          toast(choice === "stay" ? "Neues Passwort gesichert. Der Abgleich läuft." : "Neues Passwort gesichert. Dieser Browser ist abgemeldet.");
        } else {
          toast("Neues Passwort gesichert.");
        }
        app.navigate("#/mehr/konto", { replace: true });
      });
    },
  };
}
