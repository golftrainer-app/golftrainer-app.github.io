// Videos im Team in der Web-App, wie ClipViews in der App: Spieler sehen ihre
// Videos an die Trainer mit dem Feedback und löschen sie, Trainer sehen die
// Videos jedes Spielers, spielen sie in Zeitlupe und Bild für Bild ab und
// geben Feedback, Admins prüfen gemeldete Videos. Hochladen geht nur in der
// App: Sie schneidet das Video auf den Schwung, ohne Ton und Metadaten.
import { describe } from "../account.js";
import { formatShortDate, formatTime } from "../core/dates.js";
import { LIMITS } from "../core/model.js";
import { dateOf, sameID, uid } from "../core/team.js";
import { CLIP_LIMITS, clipTitle } from "../core/teamclips.js";
import { ask, chapter, empty, html, labeled } from "../ui.js";
import { TEAM_HOME, mountActions, note, takeMessage } from "./team.js";

const RATES = [
  [0.125, "⅛"],
  [0.25, "¼"],
  [0.5, "½"],
  [1, "1×"],
];
const seconds = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const oneDecimal = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** Stelle und Geschwindigkeit überleben das Neuzeichnen, z. B. nach dem Feedback. */
const playback = { clipID: null, time: 0, rate: 0.25 };
const feedbackForm = { clipID: null, text: "", message: null };

export function clipHref(clip) {
  return `#/team/videos/${encodeURIComponent(uid(clip.id))}`;
}

function stampText(value) {
  const date = dateOf(value);
  return date ? `${formatShortDate(date)}, ${formatTime(date)}` : null;
}

function lengthText(clip) {
  const parts = [`${oneDecimal.format(Number(clip.duration) || 0)} s`];
  if (clip.bytes != null) parts.push(`${oneDecimal.format(Number(clip.bytes) / 1_000_000)} MB`);
  return parts.join(" · ");
}

/** Eine Zeile in einer Liste, mit der Zahl der Rückmeldungen. */
export function clipRow(clip, team) {
  const feedback = team.data.comments(clip.memberID, { clipID: clip.id, hiding: team.blocked }).length;
  return html`<li>
    <a class="row" href="${clipHref(clip)}">
      <span class="row-main">
        <span class="row-title">${clipTitle(clip)}</span>
        <span class="row-sub">${[stampText(clip.recordedAt), lengthText(clip)].filter(Boolean).join(" · ")}</span>
      </span>
      ${feedback > 0 ? html`<span class="kicker">${feedback} Feedback</span>` : ""}
      <span class="mark" aria-hidden="true">›</span>
    </a>
  </li>`;
}

/** Wer ein Video sehen darf: die Person selbst, die Trainer und die Admins (für Meldungen). */
function maySee(team, memberID) {
  return sameID(memberID, team.myMemberID) || team.isCoach || team.isAdmin;
}

/** #/team/videos: die eigenen Videos (Spieler). #/team/mitglieder/<id>/videos: die eines Spielers (Trainer). */
export function teamClipsPage(app, memberID = null) {
  const team = app.team;
  const target = memberID ? uid(memberID) : null;
  return {
    title: target ? "Videos" : "Meine Videos",
    tab: "mehr",
    parent: target ? `#/team/mitglieder/${encodeURIComponent(target)}` : TEAM_HOME,
    render() {
      const me = team.myMemberID;
      const owner = target ?? me;
      if (!me || !owner) return empty("Du bist in keinem Team.");
      if (!maySee(team, owner)) return empty("Videos der Spieler sehen nur die Trainer.");
      const isMine = sameID(owner, me);
      const clips = team.data.clips(owner);
      return html`${takeMessage(team)}
        ${chapter(
          isMine ? "" : team.data.name(owner),
          html`${clips.length === 0
            ? empty(isMine ? "Noch kein Video im Team. In der App „Golf Trainer“ schickst du im Clip-Player mit „An die Trainer schicken“ deinen Schwung: kurz, ohne Ton, nur der Schwung." : "Noch kein Video.")
            : ""}
            <ul class="rows">${clips.map((clip) => clipRow(clip, team))}</ul>`,
        )}
        ${isMine
          ? chapter("Platz", html`<ul class="rows facts">${labeled("Videos im Team", `${clips.length} von ${CLIP_LIMITS.perMember}`)}</ul>`, {
              footer: `Höchstens ${CLIP_LIMITS.perMember} Videos, je bis ${CLIP_LIMITS.seconds} Sekunden. Beim nächsten geht das älteste. Sehen können sie nur du, die Trainer und bei einer Meldung die Admins. Löschen kannst du jederzeit, hochladen geht in der App.`,
            })
          : ""}`;
    },
  };
}

/** #/team/videos/<id>: ein Video mit Zeitlupe, Bild für Bild und dem Feedback. */
export function teamClipPage(app, clipID) {
  const team = app.team;
  const id = uid(clipID);
  const name = `clip.${id}`;
  const parentOf = (clip) => (clip && !sameID(clip.memberID, team.myMemberID) ? `#/team/mitglieder/${encodeURIComponent(uid(clip.memberID))}/videos` : "#/team/videos");
  return {
    title: "Video",
    tab: "mehr",
    parent: parentOf(team.data.get(name)),
    // Der Abgleich zeichnet die Seite nicht neu: Das Video liefe sonst von vorn.
    keepOnChange: true,
    render() {
      const clip = team.data.get(name);
      if (!clip) return empty("Das Video ist nicht mehr im Team.");
      const me = team.myMemberID;
      if (!me || !maySee(team, clip.memberID)) return empty("Videos der Spieler sehen nur die Trainer.");
      const data = team.data;
      const isMine = sameID(clip.memberID, me);
      const comments = data.comments(clip.memberID, { clipID: id, hiding: team.blocked });
      const blocked = isMine && team.needsParentalConsent;
      if (feedbackForm.clipID !== id) Object.assign(feedbackForm, { clipID: id, text: "", message: null });
      return html`${takeMessage(team)}
        <div class="player clip-player" data-clip>
          <div class="video-frame">
            <video playsinline muted loop preload="auto" data-video></video>
            <p class="video-loading" data-loading>Video wird geladen …</p>
          </div>
          <input type="range" min="0" max="0" step="0.001" value="0" data-scrub aria-label="Stelle im Video">
          <p class="video-time"><span data-time>0,00 s</span><span data-length></span></p>
          <div class="transport">
            <button type="button" class="button outline" data-action="start">Anfang</button>
            <button type="button" class="button outline" data-action="previous" aria-label="Ein Bild zurück">‹ Bild</button>
            <button type="button" class="button" data-action="play">Abspielen</button>
            <button type="button" class="button outline" data-action="next" aria-label="Ein Bild vor">Bild ›</button>
          </div>
          <div class="choice" role="group" aria-label="Geschwindigkeit">
            ${RATES.map(([value, label]) => html`<button type="button" data-rate="${value}" aria-pressed="${String(value === playback.rate)}">${label}</button>`)}
          </div>
          ${clip.impactOffset != null ? html`<div class="buttons"><button type="button" class="button outline" data-action="impact">Zum Treffmoment</button></div>` : ""}
        </div>
        ${chapter(
          clipTitle(clip),
          html`<ul class="rows facts">
              ${labeled("Von", data.name(clip.memberID))}
              ${stampText(clip.recordedAt) ? labeled("Aufgenommen", stampText(clip.recordedAt)) : ""}
              ${stampText(clip.sharedAt) ? labeled("Geschickt", stampText(clip.sharedAt)) : ""}
              ${labeled("Länge", lengthText(clip))}
            </ul>
            ${clip.note ? html`<p class="serif">${clip.note}</p>` : ""}`,
        )}
        ${chapter(
          "Feedback",
          html`${comments.length === 0 ? empty("Noch kein Feedback.") : ""}
            ${comments.map((comment) => {
              const mine = sameID(comment.authorID, me);
              const when = stampText(comment.date);
              return html`<div class="bubble${mine ? " mine" : ""}">
                <p class="kicker">${mine ? "Du" : data.name(comment.authorID)}${when ? ` · ${when}` : ""}${mine ? "" : html` · <a href="#/team/melden/comment/${encodeURIComponent(uid(comment.id))}">Melden</a>`}</p>
                <p class="serif">${comment.text}</p>
              </div>`;
            })}
            <form class="editor" novalidate data-feedback>
              <label class="field"><span>${isMine ? "Antwort" : "Feedback"}</span><textarea name="text" rows="3" maxlength="${LIMITS.textLength}" ${blocked ? "disabled" : ""} data-key="text">${feedbackForm.text}</textarea></label>
              <div class="buttons"><button type="submit" class="button flag wide" ${blocked ? "disabled" : ""} data-key="send">Senden</button></div>
              ${note(feedbackForm.message)}
            </form>`,
          {
            footer: blocked
              ? "Antworten kannst du, sobald deine Eltern einverstanden sind. Trag es unter „Profil“ ein."
              : isMine
                ? "Sehen nur du und die Trainer. Beleidigungen fängt ein Wortfilter ab, Melden geht an die Admins."
                : `Sehen nur ${data.name(clip.memberID)} und die Trainer. Beleidigungen fängt ein Wortfilter ab.`,
          },
        )}
        ${chapter(
          "",
          html`${isMine || team.isAdmin ? html`<button type="button" class="action danger" data-action="delete">Video aus dem Team löschen</button>` : ""}
            ${isMine ? "" : html`<a class="action" href="#/team/melden/clip/${encodeURIComponent(id)}">Video melden<span class="mark" aria-hidden="true">!</span></a>`}`,
          {
            footer: isMine
              ? "Löschen nimmt das Video und das Feedback dazu aus dem Team. Dein Clip in der App bleibt."
              : "Eine Kopie in deine eigenen Clips, mit Linien und Analyse, übernimmst du in der App auf dem iPhone oder iPad.",
          },
        )}`;
    },
    mount(root) {
      const clip = team.data.get(name);
      const area = root.querySelector("[data-clip]");
      if (!clip || !area) return undefined;
      let objectURL = null;
      let stopPlayer = null;
      let gone = false;
      team
        .clipFile(clip)
        .then((blob) => {
          if (gone) return;
          objectURL = URL.createObjectURL(blob);
          area.querySelector("[data-loading]")?.remove();
          stopPlayer = mountClipPlayer(area, objectURL, clip);
        })
        .catch((error) => {
          if (gone) return;
          const loading = area.querySelector("[data-loading]");
          if (loading) loading.textContent = `Das Video ließ sich nicht laden: ${describe(error)}`;
        });
      const form = root.querySelector("form[data-feedback]");
      form?.addEventListener("input", () => {
        feedbackForm.text = form.elements.text.value;
      });
      form?.addEventListener("submit", (event) => {
        event.preventDefault();
        const problem = team.sendComment(form.elements.text.value, clip.memberID, { clipID: id });
        if (problem) {
          feedbackForm.message = { text: problem, isProblem: true };
        } else {
          feedbackForm.text = "";
          feedbackForm.message = null;
        }
        app.render({ keepScroll: true });
      });
      mountActions(root, app, {
        delete: async () => {
          const choice = await ask({ title: "Video aus dem Team löschen?", message: "Das Video und das Feedback dazu verschwinden bei allen.", actions: [{ label: "Löschen", value: "delete", style: "danger" }] });
          if (choice !== "delete") return;
          const parent = parentOf(clip);
          team.deleteClip(clip);
          app.back(parent);
        },
      });
      return () => {
        gone = true;
        stopPlayer?.();
        if (objectURL) URL.revokeObjectURL(objectURL);
      };
    },
  };
}

/** Wiedergabe in Zeitlupe und Bild für Bild, wie der Clip-Player der App. Gibt eine Funktion zum Aufräumen zurück. */
function mountClipPlayer(area, url, clip) {
  const video = area.querySelector("[data-video]");
  const scrub = area.querySelector("[data-scrub]");
  const timeLabel = area.querySelector("[data-time]");
  const lengthLabel = area.querySelector("[data-length]");
  const playButton = area.querySelector("[data-action='play']");
  const sameClip = playback.clipID === uid(clip.id);
  playback.clipID = uid(clip.id);
  if (!sameClip) playback.time = 0;
  /** Dauer eines Bilds: aus dem Eintrag, dann aus den gezeigten Bildern gelernt. */
  let frame = 1 / (Number(clip.frameRate) > 0 ? Number(clip.frameRate) : 30);
  let lastMediaTime = null;
  let frameHandle = null;
  let scrubbing = false;
  const deltas = [];

  video.src = url;
  video.playbackRate = playback.rate;
  video.defaultPlaybackRate = playback.rate;

  const showTime = () => {
    timeLabel.textContent = `${seconds.format(video.currentTime)} s`;
    if (!scrubbing) scrub.value = String(video.currentTime);
    playback.time = video.currentTime;
  };
  video.addEventListener("loadedmetadata", () => {
    scrub.max = String(video.duration || 0);
    lengthLabel.textContent = Number.isFinite(video.duration) ? ` von ${seconds.format(video.duration)} s` : "";
    if (sameClip && playback.time > 0 && playback.time < video.duration) video.currentTime = playback.time;
    else video.play().catch(() => {});
  });
  video.addEventListener("error", () => {
    lengthLabel.textContent = "";
    timeLabel.textContent = "Dieses Video kann der Browser nicht abspielen.";
  });
  video.addEventListener("timeupdate", showTime);
  video.addEventListener("seeked", showTime);
  video.addEventListener("play", () => {
    playButton.textContent = "Pause";
  });
  video.addEventListener("pause", () => {
    playButton.textContent = "Abspielen";
  });
  video.addEventListener("click", () => togglePlay());

  // Jedes neu gezeigte Bild: Anzeige nachführen und die Bilddauer lernen (Median der letzten Abstände).
  const onFrame = (_, metadata) => {
    if (lastMediaTime != null) {
      const delta = metadata.mediaTime - lastMediaTime;
      if (delta > 1 / 300 && delta < 0.2) {
        deltas.push(delta);
        if (deltas.length > 30) deltas.shift();
        const sorted = [...deltas].sort((a, b) => a - b);
        frame = sorted[Math.floor(sorted.length / 2)];
      }
    }
    lastMediaTime = metadata.mediaTime;
    showTime();
    frameHandle = video.requestVideoFrameCallback(onFrame);
  };
  if ("requestVideoFrameCallback" in video) frameHandle = video.requestVideoFrameCallback(onFrame);

  function togglePlay() {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }

  function seek(time) {
    video.pause();
    lastMediaTime = null;
    video.currentTime = Math.min(Math.max(time, 0), video.duration || 0);
  }

  scrub.addEventListener("input", () => {
    scrubbing = true;
    video.pause();
    video.currentTime = Number(scrub.value);
  });
  scrub.addEventListener("change", () => {
    scrubbing = false;
  });
  area.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.rate) {
      playback.rate = Number(button.dataset.rate);
      video.playbackRate = playback.rate;
      video.defaultPlaybackRate = playback.rate;
      for (const other of area.querySelectorAll("[data-rate]")) other.setAttribute("aria-pressed", String(other === button));
      return;
    }
    switch (button.dataset.action) {
      case "play":
        togglePlay();
        break;
      case "start":
        seek(0);
        break;
      case "previous":
        seek(video.currentTime - frame);
        break;
      case "next":
        seek(video.currentTime + frame);
        break;
      case "impact":
        seek(Number(clip.impactOffset) || 0);
        break;
      default:
        break;
    }
  });
  return () => {
    if (frameHandle != null && "cancelVideoFrameCallback" in video) video.cancelVideoFrameCallback(frameHandle);
    video.pause();
    video.removeAttribute("src");
    video.load();
  };
}
