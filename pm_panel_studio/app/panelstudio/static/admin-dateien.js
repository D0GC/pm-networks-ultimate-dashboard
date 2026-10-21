/* PM Panel Studio – Dateimanager der Admin-Ansicht: Ordner der Installation durchsuchen, hoch- und herunterladen,
   Textdateien bearbeiten, Ordner und Dateien anlegen, umbenennen, löschen. Nur für Administratoren (prüft der Server). */
(function () {
  "use strict";
  const PS = window.PS;
  const { E, knopf } = PS.bau;
  const AKTION = { "X-PMPS-Aktion": "1" };
  const TEXT_ENDUNGEN = /\.(ya?ml|json|jinja2?|j2|txt|md|py|js|css|html?|xml|conf|cfg|ini|toml|csv|log|sh|env|properties|service|sql|svg|lua|rb|php|ts)$/i;
  let ort = "";  // aktueller Ordner, z. B. „config/packages“

  const groesse = (b) => b == null ? "" : b < 1024 ? `${b} B` : b < 1048576 ? `${PS.zahl(b / 1024, 1)} KB` : b < 1073741824 ? `${PS.zahl(b / 1048576, 1)} MB` : `${PS.zahl(b / 1073741824, 2)} GB`;
  const datum = (s) => s ? new Date(s * 1000).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const verbinden = (a, b) => [a, b].filter(Boolean).join("/");
  const ladenUrl = (pfad) => "api/dateien/laden?pfad=" + encodeURIComponent(pfad);
  const icon = (e) => e.ordner ? (ort ? "folder" : "folder-cog-outline") : TEXT_ENDUNGEN.test(e.name) ? "file-document-outline"
    : /\.(png|jpe?g|gif|webp|bmp|ico)$/i.test(e.name) ? "file-image-outline" : /\.(wav|mp3|ogg|flac|m4a)$/i.test(e.name) ? "file-music-outline"
      : /\.(tar|zip|gz|7z)$/i.test(e.name) ? "folder-zip-outline" : "file-outline";

  async function anfrage(url, opts = {}) {
    const r = await fetch(url, { cache: "no-store", ...opts });
    if (!r.ok) { const t = await r.text(); const f = new Error(t.replace(/<[^>]+>/g, "").trim() || r.statusText); f.status = r.status; throw f; }
    return r.json();
  }
  const aktion = (daten) => anfrage("api/dateien/aktion", { method: "POST", headers: { "Content-Type": "application/json", ...AKTION }, body: JSON.stringify(daten) });

  // ------------------------------------------------------------ Liste
  async function liste(el) {
    el.innerHTML = "";
    el.classList.add("admin-seite", "dm-seite");
    const kopf = E('<div class="dm-kopf"><nav class="dm-pfad" aria-label="Pfad"></nav><div class="reihe dm-werkzeug"></div></div>');
    const eingabe = E('<div class="dm-eingabe" hidden></div>');
    const meldung = E('<div class="dm-meldung" hidden></div>');
    const tabelle = E('<div class="as-tabelle dm-liste"><table><thead><tr><th>Name</th><th>Größe</th><th>Geändert</th><th></th></tr></thead><tbody><tr><td colspan="4" class="leer">Wird geladen …</td></tr></tbody></table></div>');
    const datei = E('<input type="file" multiple hidden>');
    el.append(kopf, eingabe, meldung, tabelle, datei);

    // Brotkrumen
    const teile = ort ? ort.split("/") : [];
    const pfad = kopf.querySelector(".dm-pfad");
    const krume = (text, ziel) => { const b = E(`<button type="button">${PS.esc(text)}</button>`); b.addEventListener("click", () => { ort = ziel; liste(el); }); return b; };
    pfad.appendChild(krume("Alle Ordner", ""));
    teile.forEach((t, i) => { pfad.append(E('<span aria-hidden="true">/</span>'), krume(t, teile.slice(0, i + 1).join("/"))); });

    let d;
    try { d = await anfrage("api/dateien/liste?pfad=" + encodeURIComponent(ort)); }
    catch (e) { tabelle.querySelector("tbody").innerHTML = `<tr><td colspan="4" class="leer">${PS.esc(e.message)}</td></tr>`; return; }
    const schreibbar = !!ort && !d.schreibgeschuetzt;

    const zeigen = (text, fehler, knoepfe = []) => {
      meldung.hidden = false; meldung.className = "dm-meldung" + (fehler ? " fehler" : "");
      meldung.innerHTML = `<span>${PS.esc(text)}</span>`; meldung.append(...knoepfe);
    };
    const fragen = (titel, wert, ok) => {
      eingabe.hidden = false; eingabe.innerHTML = "";
      const f = E(`<input class="feld" id="dm-name" type="text" autocomplete="off" spellcheck="false" aria-label="${PS.esc(titel)}" placeholder="${PS.esc(titel)}">`);
      f.value = wert || "";
      const los = async () => { const v = f.value.trim(); if (!v) return; try { await ok(v); eingabe.hidden = true; } catch (e) { zeigen(e.message, true); } };
      f.addEventListener("keydown", (ev) => { if (ev.key === "Enter") los(); if (ev.key === "Escape") eingabe.hidden = true; });
      eingabe.append(E(`<b>${PS.esc(titel)}</b>`), f, knopf("OK", "check", los, "primaer"), knopf("Abbrechen", "close", () => { eingabe.hidden = true; }));
      setTimeout(() => { f.focus(); const p = f.value.lastIndexOf("."); f.setSelectionRange(0, p > 0 ? p : f.value.length); }, 30);
    };

    const w = kopf.querySelector(".dm-werkzeug");
    if (schreibbar) {
      w.append(
        knopf("Hochladen", "upload", () => datei.click(), "primaer"),
        knopf("Neuer Ordner", "folder-plus-outline", () => fragen("Name des Ordners", "", async (n) => { await aktion({ art: "ordner", pfad: ort, name: n }); liste(el); })),
        knopf("Neue Datei", "file-plus-outline", () => fragen("Name der Datei", "", async (n) => { await aktion({ art: "datei", pfad: ort, name: n }); oeffnen(verbinden(ort, n)); })),
      );
    }
    if (ort) w.appendChild(knopf("Ordner als ZIP", "folder-download-outline", () => { location.href = ladenUrl(ort); }));
    w.appendChild(knopf("", "refresh", () => liste(el), "rund"));

    // Hochladen mit Fortschritt (auch per Ziehen und Ablegen auf die Liste)
    const hochladen = (dateien, ueberschreiben = false) => {
      if (!dateien.length) return;
      const form = new FormData();
      [...dateien].forEach((f) => form.append("datei", f, f.name));
      const x = new XMLHttpRequest();
      x.open("POST", `api/dateien/hochladen?pfad=${encodeURIComponent(ort)}${ueberschreiben ? "&ueberschreiben=1" : ""}`);
      x.setRequestHeader("X-PMPS-Aktion", "1");
      const summe = [...dateien].reduce((s, f) => s + f.size, 0);
      zeigen(`Lade ${dateien.length} Datei${dateien.length > 1 ? "en" : ""} hoch (${groesse(summe)}) …`);
      x.upload.onprogress = (ev) => { if (ev.lengthComputable) zeigen(`Hochladen … ${Math.round((ev.loaded / ev.total) * 100)} %`); };
      x.onload = () => {
        if (x.status === 409) {
          zeigen(x.responseText || "Datei existiert bereits.", true, [knopf("Überschreiben", "file-replace-outline", () => hochladen(dateien, true), "gefahr")]);
          return;
        }
        if (x.status >= 400) { zeigen(x.responseText || "Hochladen fehlgeschlagen.", true); return; }
        PS.toast(`${dateien.length} Datei${dateien.length > 1 ? "en" : ""} hochgeladen`);
        liste(el);
      };
      x.onerror = () => zeigen("Verbindung abgebrochen.", true);
      x.send(form);
    };
    datei.addEventListener("change", () => hochladen(datei.files));
    if (schreibbar) {
      tabelle.addEventListener("dragover", (ev) => { ev.preventDefault(); tabelle.classList.add("ziel"); });
      tabelle.addEventListener("dragleave", () => tabelle.classList.remove("ziel"));
      tabelle.addEventListener("drop", (ev) => { ev.preventDefault(); tabelle.classList.remove("ziel"); hochladen(ev.dataTransfer.files); });
    }

    // Einträge
    const tb = tabelle.querySelector("tbody"); tb.innerHTML = "";
    if (ort) {
      const hoch = E(`<tr class="dm-ordner"><td>${PS.ic("arrow-up")}<span>..</span></td><td></td><td></td><td></td></tr>`);
      hoch.addEventListener("click", () => { ort = teile.slice(0, -1).join("/"); liste(el); });
      tb.appendChild(hoch);
    }
    if (!d.eintraege.length) tb.appendChild(E(`<table><tr><td colspan="4" class="leer">${schreibbar ? "Leer. Dateien hierher ziehen oder „Hochladen“." : "Leer."}</td></tr></table>`).querySelector("tr"));
    d.eintraege.forEach((e) => {
      const pfadE = ort ? verbinden(ort, e.name) : e.name;
      const tr = E(`<tr class="${e.ordner ? "dm-ordner" : ""}"><td>${PS.ic(icon(e))}<span>${PS.esc(ort ? e.name : e.titel || e.name)}</span>${e.schreibgeschuetzt ? '<small>schreibgeschützt</small>' : ""}</td>
        <td class="tabular">${PS.esc(groesse(e.groesse))}</td><td class="tabular">${PS.esc(datum(e.geaendert))}</td><td class="dm-akt"></td></tr>`);
      tr.addEventListener("click", (ev) => {
        if (ev.target.closest(".dm-akt")) return;
        if (e.ordner) { ort = pfadE; liste(el); } else oeffnen(pfadE, e);
      });
      const akt = tr.querySelector(".dm-akt");
      if (ort) {
        const runter = E(`<a class="knopf rund" title="Herunterladen" aria-label="Herunterladen" href="${PS.esc(ladenUrl(pfadE))}" download>${PS.ic(e.ordner ? "folder-download-outline" : "download")}</a>`);
        akt.appendChild(runter);
      }
      if (schreibbar) {
        akt.appendChild(knopf("", "pencil-outline", () => fragen("Neuer Name", e.name, async (n) => { await aktion({ art: "umbenennen", pfad: pfadE, name: n }); liste(el); }), "rund"));
        let scharf = null;
        const weg = knopf("", "delete-outline", async () => {
          if (!scharf) {
            weg.classList.add("gefahr"); weg.title = "Nochmals klicken zum Löschen";
            zeigen(`„${e.name}“${e.ordner ? " samt Inhalt" : ""} löschen? Zum Bestätigen nochmals auf den Papierkorb klicken.`, true);
            scharf = setTimeout(() => { scharf = null; weg.classList.remove("gefahr"); meldung.hidden = true; }, 5000);
            return;
          }
          clearTimeout(scharf); scharf = null;
          try { await aktion({ art: "loeschen", pfad: pfadE }); PS.toast(`„${e.name}“ gelöscht`); liste(el); } catch (err) { zeigen(err.message, true); }
        }, "rund");
        weg.title = "Löschen";
        akt.appendChild(weg);
      }
      tb.appendChild(tr);
    });
  }

  // ------------------------------------------------------------ Editor
  async function oeffnen(pfad, e) {
    if (e && !TEXT_ENDUNGEN.test(e.name) && (e.groesse || 0) > 512 * 1024) { location.href = ladenUrl(pfad); return; }
    let d;
    try { d = await anfrage("api/dateien/text?pfad=" + encodeURIComponent(pfad)); }
    catch (err) {
      if (err.status === 415 || err.status === 413) { location.href = ladenUrl(pfad); return; }
      PS.toast(err.message, true); return;
    }
    const name = pfad.split("/").pop();
    PS.unterseite(name, (el) => {
      el.classList.add("admin-seite", "dm-seite", "dm-editor-seite");
      let stand = d.text, geaendert = d.geaendert;
      const kopf = E(`<div class="dm-kopf"><div class="dm-pfad"><span>${PS.esc(pfad)}</span></div><div class="reihe"><span class="dm-status" aria-live="polite"></span></div></div>`);
      const feld = E('<textarea class="dm-text" spellcheck="false" autocomplete="off" autocapitalize="off" wrap="off" aria-label="Inhalt"></textarea>');
      feld.value = d.text;
      const status = kopf.querySelector(".dm-status");
      const markieren = () => { const neu = feld.value !== stand; status.textContent = neu ? "Ungespeicherte Änderungen" : "Gespeichert"; status.classList.toggle("neu", neu); };
      const speichern = async () => {
        try {
          const r = await anfrage("api/dateien/speichern", { method: "POST", headers: { "Content-Type": "application/json", ...AKTION }, body: JSON.stringify({ pfad, text: feld.value, geaendert }) });
          stand = feld.value; geaendert = r.geaendert; markieren(); PS.toast(`${name} gespeichert`);
        } catch (err) { PS.toast(err.message, true); }
      };
      kopf.querySelector(".reihe").append(
        E(`<a class="knopf" href="${PS.esc(ladenUrl(pfad))}" download>${PS.ic("download")}<span>Herunterladen</span></a>`),
        knopf("Neu laden", "refresh", async () => {
          try {
            const n = await anfrage("api/dateien/text?pfad=" + encodeURIComponent(pfad));
            feld.value = stand = n.text; geaendert = n.geaendert; markieren();
          } catch (err) { PS.toast(err.message, true); }
        }),
        knopf("Speichern", "content-save-outline", speichern, "primaer"),
      );
      feld.addEventListener("input", markieren);
      feld.addEventListener("keydown", (ev) => {
        if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") { ev.preventDefault(); speichern(); return; }
        if (ev.key === "Tab" && !ev.shiftKey) {
          ev.preventDefault();
          const a = feld.selectionStart, b = feld.selectionEnd;
          feld.setRangeText("  ", a, b, "end"); markieren();
        }
      });
      el.append(kopf, feld);
      markieren();
      setTimeout(() => feld.focus(), 50);
    });
  }

  PS.module.dateien = {
    titel: "Dateien", icon: "folder-outline",
    render(el) { liste(el); },
  };
  PS.admin.module.splice(PS.admin.module.indexOf("terminal"), 0, "dateien");
})();
