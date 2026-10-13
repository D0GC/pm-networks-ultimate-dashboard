/* PM Panel Studio – Rams-Aktivität: Kartenmodell für den Feed und Detail-Popup (Karte `art: "sport"` aus karten.py) */
(function () {
  "use strict";
  const PS = window.PS, $ = (s, r = document) => r.querySelector(s);
  let offen = null;  // Karte, die gerade im Popup steht

  // Logo von ESPN (das Backend lässt nur https://a.espncdn.com durch); ohne Bild oder bei Ladefehler das Teamkürzel in Teamfarbe
  function marke(t, klasse = "") {
    const farbe = PS.esc(t.farbe || "#443171");
    const abk = `<span class="sport-abk" style="--team:${farbe}">${PS.esc(t.abk)}</span>`;
    return `<span class="sport-marke ${klasse}" data-abk="${PS.esc(t.abk)}" style="--team:${farbe}">${t.logo ? `<img src="${PS.esc(t.logo)}" alt="${PS.esc(t.name)}" loading="lazy" referrerpolicy="no-referrer">` : abk}</span>`;
  }
  // img-Fehler bubbeln nicht, daher im Capture-Modus (Inline-Handler verbietet die CSP)
  document.addEventListener("error", (ev) => {
    const img = ev.target;
    if (!(img instanceof HTMLImageElement) || !img.closest(".sport-marke")) return;
    const m = img.closest(".sport-marke"), a = m.dataset.abk;
    m.classList.add("ohne-bild");
    img.replaceWith(Object.assign(document.createElement("span"), { className: "sport-abk", textContent: a || img.alt.slice(0, 3).toUpperCase() }));
  }, true);

  // Ringfarbe: Ergebnis (Sieg grün, Niederlage rot, Remis neutral) bzw. live in Rams-Gold (führend hell, zurück gedimmt)
  const RING_FARBE = { sieg: "var(--gut)", niederlage: "var(--krit)", remis: "var(--lavender)", fuehrt: "#ffd100", gleich: "#e6b800", hinten: "#a8861a", vorschau: "#ffd100" };
  PS.sportModell = (k, m) => {
    const sp = k.spiel || {}, t = sp.team || {}, g = sp.gegner || {};
    const art = k.ring_art || "vorschau", live = k.zustand === "IN";
    // Vorschau: beide Logos mit „vs“/„@“; Live und Ergebnis: Stand mit Teamkürzeln darunter (Rams zuerst, tabellarische Ziffern)
    const innen = k.zustand === "PRE"
      ? `<div class="sport-paar">${marke(t)}${marke(g)}</div><b class="sport-stand tabular">${PS.esc(sp.auswaerts ? "@" : "vs")}</b>`
      : `<div class="sport-ergebnis"><span class="sport-zahlen tabular"><b class="${art === "niederlage" ? "leise" : ""}">${PS.esc(t.punkte)}</b><i>:</i><b class="${art === "sieg" ? "leise" : ""}">${PS.esc(g.punkte)}</b></span><span class="sport-abks"><span>${PS.esc(t.abk)}</span><span>${PS.esc(g.abk)}</span></span></div>`;
    return { ...m, kopf: "Rams", farbe: RING_FARBE[art] || "#ffd100", anteil: k.ring != null ? k.ring : 1,
      ringKlasse: `sport-ring ${live ? "sport-live" : "sport-" + art}`, innen,
      h2: k.titel, p: k.hinweis, badge: { text: k.badge, farbe: k.badge_farbe, live } };
  };

  const zeile = (name, wert) => (wert ? `<div class="sport-zeile"><span>${PS.esc(name)}</span><b>${PS.esc(wert)}</b></div>` : "");
  function zeichnen(k) {
    const sp = k.spiel || {}, t = sp.team || {}, g = sp.gegner || {};
    const dlg = $("#dialog");
    const stand = k.zustand === "PRE" ? (sp.auswaerts ? "@" : "vs") : `${t.punkte} : ${g.punkte}`;
    const seite = (x) => `<div class="sport-seite">${marke(x, "gross")}<b>${PS.esc(x.name)}</b>${x.bilanz ? `<small>${PS.esc(x.bilanz)}</small>` : ""}</div>`;
    const prob = sp.wahrscheinlichkeit != null && k.zustand !== "POST" ? `${Math.round(sp.wahrscheinlichkeit <= 1 ? sp.wahrscheinlichkeit * 100 : sp.wahrscheinlichkeit)} %` : "";
    dlg.innerHTML = `<div class="sport-ansicht" style="--farbe:${PS.esc(k.badge_farbe || "#003594")}">
      <button class="zu" aria-label="Schließen">${PS.ic("close")}</button>
      <div class="sport-kopf"><em class="sport-badge${k.zustand === "IN" ? " puls" : ""}" style="--badge:${PS.esc(k.badge_farbe)}">${PS.esc(k.badge)}</em>${sp.liga ? `<span>${PS.esc(sp.liga)}</span>` : ""}</div>
      <div class="sport-spiel">${seite(t)}<div class="sport-mitte"><b class="tabular">${PS.esc(stand)}</b><small>${PS.esc(k.hinweis)}</small></div>${seite(g)}</div>
      <div class="sport-liste">${zeile("Kickoff", sp.anpfiff)}${zeile("Stadion", sp.stadion)}${zeile("Ort", sp.ort)}${zeile("TV", sp.tv)}${zeile("Bilanz", [t.bilanz && `${t.name} ${t.bilanz}`, g.bilanz && `${g.name} ${g.bilanz}`].filter(Boolean).join(" · "))}${zeile("Siegchance", prob && `${t.name} ${prob}`)}${zeile("Saison", sp.saison)}</div>
      ${sp.letzter_zug ? `<div class="sport-zug"><small>Letzter Spielzug</small><p>${PS.esc(sp.letzter_zug)}</p></div>` : ""}
    </div>`;
    dlg.querySelector(".zu").addEventListener("click", PS.dialogSchliessen);
  }
  PS.sportZeigen = (k) => {
    const dlg = $("#dialog");
    dlg.querySelectorAll("img").forEach(PS.kameraStoppen);
    PS.kameraLiveStoppen(dlg);
    dlg.classList.remove("meldung-hoch", "meldung-normal");
    offen = k; zeichnen(k);
    dlg.dataset.popup = "rams";
    $("#dialog-grund").classList.add("offen");
  };
  // Spielstand läuft weiter: offenes Popup mit der neuen Karte füllen, bei Spielende ohne Karte schließen
  PS.on("karten", () => {
    const dlg = $("#dialog");
    if (dlg.dataset.popup !== "rams" || !$("#dialog-grund").classList.contains("offen")) return;
    const neu = (PS.karten || []).find((x) => x.id === "akt:rams");
    if (neu) { offen = neu; zeichnen(neu); } else PS.dialogSchliessen();
  });
})();
