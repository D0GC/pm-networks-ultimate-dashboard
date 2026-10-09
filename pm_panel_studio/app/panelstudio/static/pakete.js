/* PM Panel Studio – Pakete: Kartenmodell für den Feed und Detail-Popup (Karte `art: "pakete"` aus karten.py) */
(function () {
  "use strict";
  const PS = window.PS, $ = (s, r = document) => r.querySelector(s);
  const SCHRITTE = ["angekündigt", "unterwegs", "in Zustellung", "zugestellt"];
  let stand = "";  // zuletzt gezeichnete Karte (JSON), damit unveränderte Updates das Popup nicht neu aufbauen

  // Karte im Feed: Ring = Stufe der ersten Sendung (Stufe/4), Zahl = aktive Sendungen, darunter die Sendungsliste
  PS.paketeModell = (k, m) => {
    const nur = k.wert === "zugestellt";
    return { ...m, kopf: k.titel, farbe: k.problem ? "var(--krit)" : m.farbe, anteil: k.ring, zahl: String(k.anzahl),
      einheit: nur ? "heute" : k.anzahl === 1 ? "Sendung" : "Sendungen", h2: k.wert, p: k.hinweis,
      liste: k.liste && k.liste.length ? k.liste : null, listeKlasse: "pakete" };
  };

  const generisch = (s) => !s.titel || s.titel === "Sendung" || s.titel === `${s.versender}-Sendung`;
  function erwartet(s) {
    if (s.zugestellt) return ["Zugestellt", s.ereignis_zeit || "heute"];
    const wann = [s.tag, s.fenster].filter(Boolean).join(", ");
    return [s.status_code === 3 ? "Abholbereit" : "Erwartet", wann || "Termin noch offen"];
  }
  function schritte(s) {
    return SCHRITTE.map((name, i) => {
      const nr = i + 1, jetzt = nr === s.stufe, da = nr <= s.stufe;
      const text = jetzt && s.problem ? s.status : name;
      return `<li class="${da ? "da" : ""}${jetzt ? " jetzt" : ""}${jetzt && s.problem ? " problem" : ""}"><i></i><span>${PS.esc(text)}</span></li>`;
    }).join("");
  }
  function sendung(s) {
    const [label, wann] = erwartet(s);
    const meta = [s.ort, s.ereignis_zeit].filter(Boolean).join(" · ");
    const nummer = s.nummer ? `<small class="pk-nummer tabular" title="Sendungsnummer">Nr. ${PS.esc(s.nummer)}</small>` : "";
    return `<article class="pk-sendung${s.problem ? " problem" : ""}${s.zugestellt ? " fertig" : ""}">
      <header><div class="pk-titel"><b>${PS.esc(s.versender)}</b>${generisch(s) ? "" : `<span>${PS.esc(s.titel)}</span>`}</div>
        <em class="pk-status">${PS.esc(s.status)}</em></header>
      <ol class="pk-schritte" aria-label="Fortschritt">${schritte(s)}</ol>
      <div class="pk-zeile"><span>${PS.esc(label)}</span><b>${PS.esc(wann)}</b></div>
      ${s.ereignis || meta || nummer ? `<div class="pk-ereignis">${PS.ic("map-marker-outline")}<div>${s.ereignis ? `<p>${PS.esc(s.ereignis)}</p>` : ""}${meta ? `<small>${PS.esc(meta)}</small>` : ""}</div>${nummer}</div>` : ""}
    </article>`;
  }
  function zeichnen(k) {
    const dlg = $("#dialog"), liste = k.sendungen || [];
    const nur = k.wert === "zugestellt";
    const unter = nur ? `${k.anzahl} heute zugestellt` : `${k.anzahl} aktiv${k.zugestellt_heute ? ` · ${k.zugestellt_heute} heute zugestellt` : ""}`;
    const y = dlg.scrollTop;
    dlg.innerHTML = `<div class="pk-ansicht${k.problem ? " problem" : ""}">
      <button class="zu" aria-label="Schließen">${PS.ic("close")}</button>
      <div class="pk-kopf"><span class="pk-icon">${PS.ic("package-variant-closed")}</span><h2>${PS.esc(k.titel)}<small>${PS.esc(unter)}</small></h2></div>
      <div class="pk-liste">${liste.length ? liste.map(sendung).join("") : `<p class="pk-leer">${PS.esc(k.wert)}${k.hinweis ? ` · ${PS.esc(k.hinweis)}` : ""}</p>`}</div>
    </div>`;
    dlg.querySelector(".zu").addEventListener("click", PS.dialogSchliessen);
    dlg.scrollTop = y;
    stand = JSON.stringify(k);
  }
  PS.paketeZeigen = (k) => {
    const dlg = $("#dialog");
    dlg.querySelectorAll("img").forEach(PS.kameraStoppen);
    PS.kameraLiveStoppen(dlg);
    dlg.classList.remove("meldung-hoch", "meldung-normal");
    dlg.scrollTop = 0;
    zeichnen(k);
    dlg.dataset.popup = "pakete";
    $("#dialog-grund").classList.add("offen");
  };
  // Neue Lage (Status, Zeitfenster, Tageswechsel): offenes Popup nachziehen, verschwindet die Karte, schließt es
  PS.on("karten", () => {
    const dlg = $("#dialog");
    if (dlg.dataset.popup !== "pakete" || !$("#dialog-grund").classList.contains("offen")) return;
    const neu = (PS.karten || []).find((x) => x.id === "akt:pakete");
    if (!neu) PS.dialogSchliessen();
    else if (JSON.stringify(neu) !== stand) zeichnen(neu);
  });
})();
