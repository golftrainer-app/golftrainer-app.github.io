<!-- Automatisch erzeugt mit tools/generate_site.py. Bitte nicht von Hand ändern. -->

# Golf Trainer: Webseite

Die öffentliche Webseite der App „Golf Trainer“: Datenschutzerklärung, Nutzungsbedingungen, Anbieter und Kontakt, Lizenzen und Hilfe. App Store Connect verlangt eine öffentliche Datenschutz-URL und eine Support-URL. Beide kommen von hier.

Das Repository der App ist privat, und GitHub Pages gibt es im kostenlosen Plan nur für öffentliche Repositorys. Deshalb liegt die Webseite in einem eigenen, öffentlichen Repository, das nur diese Dateien enthält. Leg hier nichts anderes ab, alles darin ist öffentlich.

Die Texte stammen aus `legal.json` im Repository der App, genau wie in der App. Ändere sie dort, nicht hier. Die Seiten laden nichts von anderen Servern: keine Webfonts, kein JavaScript, keine Cookies, keine Analyse.

## Einmal einrichten

Die Dateien kommen über den Workflow „Webseite“ aus dem Repository der App hierher, bei jeder Änderung an `site/` auf `main`. Die Seite liegt bei einer eigenen Organisation, damit kein Benutzername in der Adresse steht. Das braucht einmal eine Organisation, ein Repository, einen Token und GitHub Pages:

1. **Organisation anlegen:** Auf github.com oben rechts **+** → **New organization** → **Free**. Name `golftrainer-app`, deine E-Mail als Kontakt, „My personal account“. Mitglieder braucht sie nicht.
2. **Repository anlegen:** In der Organisation **New repository**, Name genau `golftrainer-app.github.io`, **Public**, sonst nichts ankreuzen → **Create repository**. Leer lassen, der Workflow füllt es. Bei diesem Namen liegt die Seite direkt unter `https://golftrainer-app.github.io/`. Ein anderer Ort geht auch: Dann im Repository der App unter **Settings** → **Secrets and variables** → **Actions** → **Variables** die Variable `PAGES_REPOSITORY` mit `BESITZER/NAME` anlegen.
3. **Token erzeugen:** Auf github.com oben rechts auf das Profilbild → **Settings** → ganz unten **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**. Name z. B. `Golf Trainer Webseite`, Ablauf so lang wie möglich. Bei **Resource owner** die Organisation wählen. Bei **Repository access** „Only select repositories“ und nur das Repository der Webseite. Bei **Permissions** → **Repository permissions** bei **Contents** „Read and write“ wählen, sonst nichts → **Generate token**. Den Token gleich kopieren, GitHub zeigt ihn nur einmal. Taucht die Organisation nicht als Resource owner auf: In der Organisation **Settings** → **Personal access tokens** → **Settings** den Zugriff über Fine-grained tokens erlauben.
4. **Token eintragen:** Im Repository der App **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Name `PAGES_TOKEN`, als Secret den Token → **Add secret**. Der Token kommt nie in den Code, und er kann nur in das Repository der Webseite schreiben.
5. **Erste Übertragung:** Im Repository der App **Actions** → **Webseite** → **Run workflow** → **Run workflow**. Nach etwa einer Minute liegen alle Dateien hier, auch die leere Datei `.nojekyll`, damit GitHub Pages die Dateien unverändert ausliefert.
6. **GitHub Pages prüfen:** Bei einem Repository mit dem Namen `….github.io` schaltet GitHub Pages von selbst ein. Zur Sicherheit hier **Settings** → **Pages**: bei **Source** „Deploy from a branch“, bei **Branch** `main` und der Ordner `/ (root)`. Nach ein paar Minuten ist die Seite unter `https://golftrainer-app.github.io/` erreichbar.

Ohne den Workflow geht es auch von Hand: alle Dateien aus dem Ordner `site/` über **Add file** → **Upload files** hochladen und `.nojekyll` über **Add file** → **Create new file** anlegen. Ordner lassen sich auf dem iPad schlecht hochladen, deshalb ist der Workflow der einfachere Weg.

## In App Store Connect eintragen

| Feld | Adresse |
|---|---|
| Datenschutz-URL (Privacy Policy URL), unter **App-Datenschutz** | `https://golftrainer-app.github.io/datenschutz.html` |
| Support-URL (Support URL), auf der Seite der Version | `https://golftrainer-app.github.io/support.html` |

Solange auf den Seiten „Die Anbieterangaben fehlen noch“ steht, sind sie nicht fertig. Dann zuerst Name, Anschrift und E-Mail in `legal.json` eintragen, die Seiten neu erzeugen und nach `main` bringen.

## Nach jeder Änderung an legal.json

1. Im Repository der App `python3 tools/generate_site.py` ausführen (macht Claude mit).
2. Die Änderung nach `main` bringen. Der Workflow „Webseite“ überträgt `site/` von selbst hierher. Läuft er auf einen Fehler, ist meist der Token abgelaufen: einen neuen erzeugen und das Secret `PAGES_TOKEN` ersetzen.

Die Dateinamen bitte nicht ändern, sonst stimmen die Adressen in App Store Connect nicht mehr.
