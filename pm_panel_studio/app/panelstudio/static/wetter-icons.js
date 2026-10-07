/* PM Panel Studio – animierte Wetter- und Warnsymbole (Inline-SVG, Animation rein per CSS, siehe wetter-icons.css). */
(function () {
  "use strict";
  const PS = window.PS;

  // ------------------------------------------------------------ Bausteine
  const svg = (inner) =>
    '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true" focusable="false">' + inner + "</svg>";

  const WOLKE = "M18 48a10 10 0 0 1-1.2-19.9A15 15 0 0 1 45.5 25.5 11.2 11.2 0 0 1 46 48Z";

  // Positionsgruppe (statisches transform-Attribut, Animationen laufen in Kindgruppen)
  const pos = (x, y, s, inner) => `<g class="wi-pos" transform="translate(${x} ${y}) scale(${s})">${inner}</g>`;

  // Wolke mit seitlicher Drift; aufhell = Aufhell-Fläche für den Blitz
  function wolke(x, y, s, zug = "", aufhell = false) {
    return pos(x, y, s,
      `<g class="wi-zug ${zug}"><path d="${WOLKE}"/>` +
      (aufhell ? `<path class="wi-aufhell" d="${WOLKE}"/>` : "") + "</g>");
  }

  // Strahlenkranz aus Linien (Winkel in Grad, 0 = rechts)
  function strahlen(r1, r2, winkel) {
    return winkel.map((w) => {
      const a = (w * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
      return `M${(c * r1).toFixed(2)} ${(s * r1).toFixed(2)}L${(c * r2).toFixed(2)} ${(s * r2).toFixed(2)}`;
    }).join("");
  }
  const ALLE8 = [0, 45, 90, 135, 180, 225, 270, 315];

  // Sonne um (0,0): Kern atmet, Strahlen pulsieren, optional langsame Drehung
  function sonne(x, y, s, dreh = true, winkel = ALLE8, r1 = 13, r2 = 19, kern = 8) {
    return pos(x, y, s,
      `<g class="${dreh ? "wi-dreh" : ""}"><path class="wi-strahl w-sonne" d="${strahlen(r1, r2, winkel)}"/></g>` +
      `<circle class="wi-kern w-sonne" r="${kern}"/>`);
  }

  // Tropfen: [x, y, Verzögerung, Dauer]
  const tropfen = (l) => l.map(([x, y, d, t]) =>
    `<path class="wi-tropfen w-regen" d="M${x} ${y}l-1.6 4.6" style="animation-delay:${d}s;animation-duration:${t}s"/>`).join("");
  const flocken = (l, klasse = "wi-flocke") => l.map(([x, y, d, t]) =>
    `<g class="${klasse}" style="animation-delay:${d}s;animation-duration:${t}s"><circle class="w-schnee wi-pendel" cx="${x}" cy="${y}" r="2.1" ` +
    `style="animation-delay:${d}s"/></g>`).join("");
  const koerner = (l) => l.map(([x, y, d, t]) =>
    `<circle class="wi-hagel w-regen" cx="${x}" cy="${y}" r="2" style="animation-delay:${d}s;animation-duration:${t}s"/>`).join("");

  const BLITZ = "M35 38 27 51h7l-4 12 13-17h-7l4-8Z";
  const blitz = (x = 0, y = 0, s = 1) =>
    pos(x, y, s, `<path class="wi-blitz w-blitz" d="${BLITZ}"/>`);

  // Windlinien mit pathLength 100: Striche strömen per stroke-dashoffset
  const windlinie = (d, klasse, dauer, versatz) =>
    `<path class="wi-wind ${klasse}" pathLength="100" d="${d}" style="animation-duration:${dauer}s;animation-delay:${versatz}s"/>`;

  const DREIECK = "M32 8 58 54H6Z";
  const ausruf = (klasse) =>
    `<g class="${klasse}"><path class="w-sonne" d="M32 25v14"/><circle class="w-sonne" cx="32" cy="46" r="1.6" fill="#f0b44c"/></g>`;

  const flocke = (klein) => {
    const arm = '<path d="M32 8v48M26 14l6 6 6-6M26 50l6-6 6 6"/>';
    return [0, 60, 120].map((w) => `<g class="wi-pos" transform="rotate(${w} 32 32)">${arm}</g>`).join("");
  };

  // ------------------------------------------------------------ Wetterzustände
  const WETTER = {
    sunny: () => sonne(32, 32, 1.35),
    "clear-night": () =>
      '<path d="M40 9A23 23 0 1 0 55 41 18 18 0 0 1 40 9Z"/>' +
      '<path class="wi-stern w-schnee" d="M47 15v7M43.5 18.5h7" style="animation-delay:-.6s"/>' +
      '<path class="wi-stern w-schnee" d="M54 29v5M51.5 31.5h5" style="animation-delay:-1.7s"/>' +
      '<circle class="wi-stern w-schnee" cx="40" cy="26" r="1.7" style="animation-delay:-2.4s"/>',
    partlycloudy: () =>
      pos(21, 21, 1,
        `<path class="wi-strahl w-sonne" d="${strahlen(11, 16, [135, 180, 225, 270, 315, 0])}"/>` +
        '<path class="wi-kern w-sonne" d="M-5-5A7 7 0 1 1 5 5"/>') +
      wolke(11, 13, .84),
    cloudy: () =>
      wolke(16, 0, .62, "wi-zug2") + wolke(-1, 9, .96),
    rainy: () => wolke(0, -7, 1) + tropfen([[22, 46, -.2, 1.6], [32, 48, -1.0, 1.75], [42, 46, -.6, 1.5]]),
    pouring: () => wolke(0, -7, 1) + tropfen([
      [16, 46, -.1, .9], [24, 49, -.6, .97], [32, 46, -.3, .85], [40, 49, -.75, 1.02], [48, 46, -.45, .88]]),
    lightning: () => wolke(0, -7, 1, "", true) + blitz(),
    "lightning-rainy": () =>
      wolke(0, -7, 1, "", true) + blitz(0, 0, .9) +
      tropfen([[17, 46, -.3, 1.4], [49, 46, -1.0, 1.55]]),
    snowy: () => wolke(0, -7, 1) + flocken([[22, 47, -.3, 3.6], [32, 49, -1.9, 4.1], [42, 47, -1.1, 3.3]]),
    "snowy-rainy": () =>
      wolke(0, -7, 1) + flocken([[20, 47, -.3, 3.6], [42, 47, -1.9, 3.95]]) +
      tropfen([[28, 47, -.5, 1.5], [49, 47, -1.0, 1.65]]),
    fog: () =>
      wolke(0, -10, .95) +
      '<path class="wi-nebel nb1" d="M10 46h30" /><path class="wi-nebel nb2" d="M24 54h30"/>',
    hail: () => wolke(0, -7, 1) + koerner([
      [20, 47, -.2, 1], [29, 50, -.7, 1.1], [38, 47, -.45, .93], [47, 50, -.9, 1.05], [34, 49, -.05, .97]]),
    windy: () =>
      windlinie("M6 22H38a7 7 0 1 0-7-7", "", 2.6, -.4) +
      windlinie("M6 34H50a8 8 0 1 1-8 8", "", 3, -1.5) +
      windlinie("M6 46H28a6 6 0 1 1-6 6", "", 2.2, -.9),
    "windy-variant": () =>
      wolke(0, -12, .95) +
      windlinie("M8 46H44a6 6 0 1 0-6-6", "", 2.6, -.4) +
      windlinie("M14 56H34a5 5 0 1 1-5 5", "", 2.2, -1.3),
    exceptional: () =>
      `<g class="wi-puls"><path d="${DREIECK}"/>${ausruf("")}</g>`,
  };

  // ------------------------------------------------------------ Warnungstypen
  const WARN = {
    gewitter: () => wolke(0, -7, 1, "", true) + blitz(0, 0, .95) +
      '<path class="wi-einschlag w-blitz" d="M17 62h30"/>',
    sturm: () =>
      windlinie("M5 20H40a8 8 0 1 0-8-8", "wi-stark", 1.7, -.3) +
      windlinie("M5 34H52a9 9 0 1 1-9 9", "wi-stark", 2.0, -1.2) +
      windlinie("M5 49H30a7 7 0 1 1-7 7", "wi-stark", 1.5, -.8),
    regen: () => wolke(0, -8, 1) + tropfen([
      [14, 45, -.1, .8], [22, 48, -.5, .86], [30, 45, -.3, .76], [38, 48, -.65, .9], [46, 45, -.2, .82], [54, 48, -.45, .78]]),
    schnee: () => wolke(0, -8, 1) + flocken([
      [16, 46, -.3, 3.4], [26, 49, -1.9, 3.9], [36, 46, -1.1, 3.1], [46, 49, -2.6, 3.7], [54, 46, -.8, 3.3]]),
    glaette: () =>
      `<g class="wi-dreh wi-langsam w-schnee-l">${flocke()}</g>` +
      '<path class="wi-glanz w-schnee" d="M18 50 46 14" stroke-width="3"/>',
    frost: () => `<g class="wi-dreh wi-langsam w-schnee-l">${flocke()}</g>`,
    nebel: () =>
      '<path class="wi-nebel nb1" d="M10 16h34"/><path class="wi-nebel nb2" d="M18 27h36"/>' +
      '<path class="wi-nebel nb1" d="M10 38h38"/><path class="wi-nebel nb2" d="M16 49h34"/>',
    hitze: () => sonne(32, 22, .85, false, ALLE8, 13, 19, 8) +
      '<path class="wi-hitze w-sonne" d="M12 46q5-5 10 0t10 0t10 0t10 0" style="animation-delay:-.4s"/>' +
      '<path class="wi-hitze w-sonne" d="M12 56q5-5 10 0t10 0t10 0t10 0" style="animation-delay:-1.5s"/>',
    uv: () =>
      pos(32, 32, 1.35, `<path class="wi-strahl wi-kurz w-sonne" d="${strahlen(15, 19.5, ALLE8)}"/>` +
        '<circle class="w-sonne" r="11"/>') +
      '<text class="w-sonne-t" x="32" y="37" text-anchor="middle" font-size="13" font-weight="700" ' +
      'font-family="sans-serif" fill="#f0b44c" stroke="none">UV</text>',
    tauwetter: () =>
      '<path d="M8 12h48"/>' +
      '<path d="M13 12v10l5 14 5-14V12M28 12v8l4 11 4-11v-8M41 12v10l5 14 5-14V12"/>' +
      '<path class="wi-tropf w-regen" d="M18 43v3" style="animation-delay:-.2s"/>' +
      '<path class="wi-tropf w-regen" d="M32 38v3" style="animation-delay:-1.6s"/>' +
      '<path class="wi-tropf w-regen" d="M46 43v3" style="animation-delay:-.9s"/>',
    allgemein: () => `<path d="${DREIECK}"/>${ausruf("wi-ausruf")}`,
  };

  // ------------------------------------------------------------ Öffentliche API
  const sauber = (s) => String(s == null ? "" : s).replace(/[^\w-]/g, "");
  const huelle = (z, klasse, inner) =>
    `<span class="wi ${sauber(klasse)}" data-z="${z}">${svg(inner)}</span>`;

  PS.wetterSvg = (zustand, klasse = "") => {
    const z = Object.prototype.hasOwnProperty.call(WETTER, zustand) ? zustand : "partlycloudy";
    return huelle(z, klasse, WETTER[z]());
  };
  PS.warnSvg = (typ, klasse = "") => {
    const t = Object.prototype.hasOwnProperty.call(WARN, typ) ? typ : "allgemein";
    return huelle(t, klasse, WARN[t]());
  };

  // Deutscher DWD-Warnungsname -> Symboltyp (Reihenfolge = Priorität)
  const STICHWORTE = [
    ["tauwetter", /tauwetter/],
    ["glaette", /gl[aä]tte|glatteis|eisregen|gl(ae|a)tteis/],
    ["gewitter", /gewitter|blitz/],
    ["sturm", /sturm|orkan|b[öo]e|wind/],
    ["regen", /regen|niederschlag|hochwasser/],
    ["schnee", /schnee|schauer.*(flocke)|verwehung/],
    ["frost", /frost|k[aä]lte/],
    ["nebel", /nebel/],
    ["hitze", /hitze|w[aä]rme|schw[uü]le/],
    ["uv", /\buv\b|uv-|ultraviolett/],
  ];
  PS.warnTyp = (name) => {
    const n = String(name || "").toLowerCase();
    for (const [typ, re] of STICHWORTE) if (re.test(n)) return typ;
    return "allgemein";
  };
})();
