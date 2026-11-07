/*
 * Seitenaufbau der Mappe. Alle Maße in Punkt (1 pt = 1/72 Zoll), A4 hochkant.
 * Jede Seite wird als Liste einfacher Elemente beschrieben (Fläche, Linie,
 * Bild, Text). Daraus entstehen sowohl die Vorschau/der Druck (SVG) als auch
 * die Word-Datei.
 */
(function (root) {
  "use strict";

  var SEITE = { b: 595.28, h: 841.89 };

  var FARBE = {
    blau: "#205484",
    rot: "#E23A3A",
    rahmenRot: "#FF0000",
    grau: "#DADADA",
    schwarz: "#000000",
  };

  var SCHRIFT = {
    punkt: { familie: "Mappe Punktschrift", gewicht: 400 },
    normal: { familie: "Mappe Druckschrift", gewicht: 400 },
    fett: { familie: "Mappe Druckschrift", gewicht: 700 },
  };

  var KARTE = {
    x: 56.69,
    b: 496.05,
    oben: [42.52, 294.79, 547.07],
    h: 252.24,
    linie: 2.49,
    versatz: 2.835, // jede Karte rückt ihren Inhalt 1 mm tiefer
  };

  var KASTEN = {
    normal: { x: 226.77, b: 311.83 },
    breit: { x: 155.84, b: 382.75 },
    h: 70.89,
    rot: 5.67,
    nachspurenY: 42.52,
    schreibenY: 141.73,
    // graues Band: Abstand vom inneren Rand oben und Höhe
    nachspurenBand: { y: 17.85, h: 23.84 },
    schreibenBand: { y: 19.85, h: 19.87 },
  };

  var PUNKT = { groesse: 63.25, abstand: 3.733, grundlinie: 89.48, stufe: 1.508 };
  // Unterschneidung nach diesen Großbuchstaben (vor Kleinbuchstaben), in pt bei voller Größe
  var PUNKT_KERN = { T: -6.19, V: -3.74, W: -3.74, Y: -3.74, K: -2.51 };
  var SILBE = { groesse: 20.32, abstand: 3.65, grundlinie: 133.58, dx: 0.76 };

  var BILD = {
    normal: { x: 70.86, y: 70.86, b: 127.58, h: 106.66 },
    breit: { x: 70.86, y: 75.47, b: 70.86, h: 106.66 },
  };

  // unter der letzten Karte (endet bei 799 pt)
  var NACHWEIS = { grundlinie: 822, groesse: 8, farbe: "#555555", metacom: "METACOM Symbole © Annette Kitzinger" };

  // ab dieser Breite des Punkt-Worts wird automatisch die breite Karte genommen
  var BREIT_AB = 294;

  var DECKBLATT = {
    titelGroesse: 72.18,
    titelGrundlinie: 296.56,
    gruppeMitte: 322.63,
    gruppeMaxBreite: 470,
    bildAbstand: 19.21,
    bild: { b: 141.76, h: 118.48, mitteY: 271.83 },
    besitzer: { groesse: 18.05, grundlinie: 513.97, mitteX: 305.78 },
    linie: { x: 127.26, grundlinie: 579.39, text: "_____________________________________" },
  };

  // --- Textmessung ---------------------------------------------------------

  var leinwand = null;

  function textBreite(text, schrift, groesse, abstand) {
    if (!leinwand) leinwand = document.createElement("canvas").getContext("2d");
    var s = SCHRIFT[schrift];
    leinwand.font = s.gewicht + " " + groesse + "px \"" + s.familie + "\"";
    var b = leinwand.measureText(text).width;
    var n = Array.from(text).length;
    return b + (abstand || 0) * Math.max(0, n - 1);
  }

  function ladeSchriften() {
    var S = root.SCHRIFTEN;
    function puffer(b64) {
      var bin = atob(b64);
      var a = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      return a.buffer;
    }
    var liste = [
      new FontFace(SCHRIFT.punkt.familie, puffer(S.punkt), { weight: "400" }),
      new FontFace(SCHRIFT.normal.familie, puffer(S.normal), { weight: "400" }),
      new FontFace(SCHRIFT.fett.familie, puffer(S.fett), { weight: "700" }),
    ];
    return Promise.all(liste.map(function (f) {
      return f.load().then(function () { document.fonts.add(f); });
    }));
  }

  // --- Silben einfärben ----------------------------------------------------

  function farbigeTeile(wort) {
    return root.Silben.silben(wort).map(function (t) {
      return { text: t.text, farbe: t.silbe < 0 ? null : (t.silbe % 2 === 0 ? FARBE.blau : FARBE.rot) };
    });
  }

  // --- Seitenmodell --------------------------------------------------------

  function flaeche(x, y, b, h, farbe) {
    return { art: "flaeche", x: x, y: y, b: b, h: h, farbe: farbe };
  }

  function rahmen(x, y, b, h, staerke, farbe) {
    return { art: "rahmen", x: x, y: y, b: b, h: h, staerke: staerke, farbe: farbe };
  }

  function linie(x1, y1, x2, y2, staerke, farbe) {
    return { art: "linie", x1: x1, y1: y1, x2: x2, y2: y2, staerke: staerke, farbe: farbe };
  }

  function lineatur(el, x, y, b, band) {
    var R = KASTEN.rot;
    var h = KASTEN.h;
    // roter Rahmen mit feiner schwarzer Außenkante
    el.push(flaeche(x, y, R, h, FARBE.rahmenRot));
    el.push(flaeche(x + b - R, y, R, h, FARBE.rahmenRot));
    el.push(flaeche(x, y, b, R, FARBE.rahmenRot));
    el.push(flaeche(x, y + h - R, b, R, FARBE.rahmenRot));
    el.push(rahmen(x, y, b, h, 0.24, FARBE.schwarz));
    var ix = x + R;
    var iy = y + R;
    var ib = b - 2 * R;
    var ih = h - 2 * R;
    el.push(flaeche(ix, iy + band.y, ib, band.h, FARBE.grau));
    el.push(rahmen(ix, iy, ib, ih, 0.57, FARBE.schwarz));
    el.push(linie(ix, iy + band.y, ix + ib, iy + band.y, 0.57, FARBE.schwarz));
    el.push(linie(ix, iy + band.y + band.h, ix + ib, iy + band.y + band.h, 1.13, FARBE.schwarz));
    return { innenX: ix, innenB: ib };
  }

  // Punkt-Wort in Teile zerlegen, damit Unterschneidungen als eigener Abstand
  // nach dem Großbuchstaben gesetzt werden können
  function punktTeile(wort, groesse, abstand) {
    var f = groesse / PUNKT.groesse;
    var zeichen = Array.from(wort);
    var teile = [];
    var kern = 0;
    var aktuell = "";
    zeichen.forEach(function (z, i) {
      var k = PUNKT_KERN[z];
      var naechstes = zeichen[i + 1];
      if (k && naechstes && /[a-zäöüß]/.test(naechstes)) {
        if (aktuell) teile.push({ text: aktuell, farbe: FARBE.schwarz, abstand: abstand });
        teile.push({ text: z, farbe: FARBE.schwarz, abstand: abstand + k * f });
        kern += k * f;
        aktuell = "";
      } else {
        aktuell += z;
      }
    });
    if (aktuell) teile.push({ text: aktuell, farbe: FARBE.schwarz, abstand: abstand });
    return { teile: teile, breite: textBreite(wort, "punkt", groesse, abstand) + kern };
  }

  // Wie im Original: lange Wörter erst enger setzen, erst danach verkleinern
  function punktEinpassen(wort, platz, startAbstand) {
    var groesse = PUNKT.groesse;
    var start = startAbstand != null ? startAbstand : PUNKT.abstand;
    var abstand = start;
    var p = punktTeile(wort, groesse, abstand);
    for (var k = 1; p.breite > platz && start - k * PUNKT.stufe / 2 >= 0; k++) {
      abstand = start - k * PUNKT.stufe / 2;
      p = punktTeile(wort, groesse, abstand);
    }
    if (p.breite > platz) {
      abstand = Math.max(0, abstand);
      var g = textBreite(wort, "punkt", groesse, 0);
      var f = platz / (g + (p.breite - g));
      groesse *= f;
      abstand *= f;
      p = punktTeile(wort, groesse, abstand);
    }
    return { groesse: groesse, teile: p.teile, breite: p.breite };
  }

  function kartenLayout(eintrag) {
    var wort = root.Silben.klartext(eintrag.wort);
    var breite = punktTeile(wort, PUNKT.groesse, PUNKT.abstand).breite;
    var art = eintrag.layout === "breit" || eintrag.layout === "normal"
      ? eintrag.layout
      : (breite > BREIT_AB ? "breit" : "normal");
    return { art: art, wort: wort, breite: breite };
  }

  function karte(el, eintrag, index) {
    var oben = KARTE.oben[index];
    var d = index * KARTE.versatz;
    var lay = kartenLayout(eintrag);
    var K = KASTEN[lay.art];

    // Kartenrahmen (Linie mittig auf der Kante)
    var s = KARTE.linie;
    el.push(rahmen(KARTE.x, oben, KARTE.b, KARTE.h, s, FARBE.schwarz));

    // Bild
    var bf = BILD[lay.art];
    if (eintrag.bild) {
      var faktor = (eintrag.bildGroesse || 100) / 100;
      var bb = bf.b * faktor;
      var bh = bf.h * faktor;
      el.push({
        art: "bild",
        x: bf.x + (bf.b - bb) / 2,
        y: oben + d + bf.y + (bf.h - bh) / 2,
        b: bb,
        h: bh,
        src: eintrag.bild,
        rolle: "pictogramm",
        id: eintrag.id,
      });
    }

    // Nachspur-Kasten mit Punktschrift
    var nach = lineatur(el, K.x, oben + d + KASTEN.nachspurenY, K.b, KASTEN.nachspurenBand);
    if (lay.wort) {
      var passend = punktEinpassen(lay.wort, nach.innenB - 2, eintrag.punktAbstand);
      el.push({
        art: "text",
        rolle: "punkt",
        id: eintrag.id,
        x: nach.innenX,
        grundlinie: oben + d + PUNKT.grundlinie,
        groesse: passend.groesse,
        abstand: 0,
        schrift: "punkt",
        teile: passend.teile,
        kastenB: nach.innenB,
      });
    }

    // Wort in Silbenfarben
    if (lay.wort) {
      el.push({
        art: "text",
        rolle: "silben",
        id: eintrag.id,
        x: K.x + SILBE.dx,
        grundlinie: oben + d + SILBE.grundlinie,
        groesse: SILBE.groesse,
        abstand: SILBE.abstand,
        schrift: "normal",
        teile: farbigeTeile(eintrag.wort),
        kastenB: K.b,
      });
    }

    // Schreib-Kasten
    lineatur(el, K.x, oben + d + KASTEN.schreibenY, K.b, KASTEN.schreibenBand);
  }

  function deckblatt(mappe) {
    var el = [];
    var D = DECKBLATT;
    var titel = (mappe.titel || "").trim();
    var klar = root.Silben.klartext(titel);
    var groesse = D.titelGroesse;
    var tb = textBreite(klar, "fett", groesse, 0);
    var mitBild = !!mappe.titelBild;
    var extra = mitBild ? (klar ? D.bildAbstand : 0) + D.bild.b : 0;
    if (tb + extra > D.gruppeMaxBreite && tb > 0) {
      var f = Math.max(0.3, (D.gruppeMaxBreite - extra) / tb);
      groesse *= f;
      tb *= f;
    }
    var start = D.gruppeMitte - (tb + extra) / 2;
    if (titel) {
      el.push({
        art: "text",
        rolle: "titel",
        x: start,
        grundlinie: D.titelGrundlinie,
        groesse: groesse,
        abstand: 0,
        schrift: "fett",
        teile: farbigeTeile(titel),
        breite: tb,
      });
    }
    if (mitBild) {
      el.push({
        art: "bild",
        rolle: "titelbild",
        x: start + tb + (klar ? D.bildAbstand : 0),
        y: D.bild.mitteY - D.bild.h / 2,
        b: D.bild.b,
        h: D.bild.h,
        src: mappe.titelBild,
      });
    }
    if ((mappe.besitzerText || "").trim()) {
      el.push({
        art: "text",
        rolle: "besitzer",
        x: D.besitzer.mitteX,
        anker: "mitte",
        grundlinie: D.besitzer.grundlinie,
        groesse: D.besitzer.groesse,
        abstand: 0,
        schrift: "normal",
        teile: [{ text: mappe.besitzerText.trim(), farbe: FARBE.schwarz }],
      });
    }
    el.push({
      art: "text",
      rolle: "linie",
      x: D.linie.x,
      grundlinie: D.linie.grundlinie,
      groesse: D.besitzer.groesse,
      abstand: -0.26,
      schrift: "normal",
      teile: [{ text: D.linie.text, farbe: FARBE.schwarz }],
    });
    return { art: "deckblatt", elemente: el };
  }

  function bildnachweis(text) {
    return {
      art: "text",
      rolle: "bildnachweis",
      x: SEITE.b / 2,
      anker: "mitte",
      grundlinie: NACHWEIS.grundlinie,
      groesse: NACHWEIS.groesse,
      abstand: 0,
      schrift: "normal",
      teile: [{ text: text, farbe: NACHWEIS.farbe }],
    };
  }

  function seiten(mappe) {
    var liste = [deckblatt(mappe)];
    var e = mappe.eintraege || [];
    for (var i = 0; i < e.length; i += 3) {
      var el = [];
      e.slice(i, i + 3).forEach(function (eintrag, k) {
        karte(el, eintrag, k);
      });
      liste.push({ art: "karten", elemente: el, ab: i });
    }
    if (mappe.metacomHinweis) {
      liste.forEach(function (s) { s.elemente.push(bildnachweis(NACHWEIS.metacom)); });
    }
    return liste;
  }

  // --- SVG -----------------------------------------------------------------

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function n(v) {
    return Math.round(v * 1000) / 1000;
  }

  function svgElement(e) {
    switch (e.art) {
      case "flaeche":
        return '<rect x="' + n(e.x) + '" y="' + n(e.y) + '" width="' + n(e.b) + '" height="' + n(e.h) + '" fill="' + e.farbe + '"/>';
      case "rahmen":
        return '<rect x="' + n(e.x) + '" y="' + n(e.y) + '" width="' + n(e.b) + '" height="' + n(e.h) +
          '" fill="none" stroke="' + e.farbe + '" stroke-width="' + e.staerke + '"/>';
      case "linie":
        return '<line x1="' + n(e.x1) + '" y1="' + n(e.y1) + '" x2="' + n(e.x2) + '" y2="' + n(e.y2) +
          '" stroke="' + e.farbe + '" stroke-width="' + e.staerke + '"/>';
      case "bild":
        return '<image href="' + esc(e.src) + '" x="' + n(e.x) + '" y="' + n(e.y) + '" width="' + n(e.b) + '" height="' + n(e.h) +
          '" preserveAspectRatio="xMidYMid meet"/>';
      case "text": {
        var s = SCHRIFT[e.schrift];
        var t = '<text x="' + n(e.x) + '" y="' + n(e.grundlinie) + '" font-family="' + s.familie + '" font-weight="' + s.gewicht +
          '" font-size="' + n(e.groesse) + '" letter-spacing="' + n(e.abstand) + '" xml:space="preserve"' +
          (e.anker === "mitte" ? ' text-anchor="middle"' : "") + ">";
        e.teile.forEach(function (teil) {
          t += '<tspan fill="' + (teil.farbe || FARBE.schwarz) + '"' +
            (teil.abstand != null ? ' letter-spacing="' + n(teil.abstand) + '"' : "") + ">" + esc(teil.text) + "</tspan>";
        });
        return t + "</text>";
      }
    }
    return "";
  }

  function istStatisch(e) {
    return e.art === "flaeche" || e.art === "rahmen" || e.art === "linie";
  }

  function svg(seite, nurStatisch) {
    var inhalt = seite.elemente
      .filter(function (e) { return !nurStatisch || istStatisch(e); })
      .map(svgElement)
      .join("");
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + SEITE.b + " " + SEITE.h + '" width="' + SEITE.b + 'pt" height="' + SEITE.h + 'pt">' +
      (nurStatisch ? "" : '<rect width="100%" height="100%" fill="#fff"/>') + inhalt + "</svg>";
  }

  root.Layout = {
    SEITE: SEITE,
    SCHRIFT: SCHRIFT,
    FARBE: FARBE,
    ladeSchriften: ladeSchriften,
    seiten: seiten,
    svg: svg,
    istStatisch: istStatisch,
    farbigeTeile: farbigeTeile,
    textBreite: textBreite,
  };
})(window);
