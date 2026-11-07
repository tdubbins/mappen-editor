/*
 * Erstellt aus der Mappe eine Word-Datei im gleichen Aussehen.
 * Rahmen und Lineatur liegen als Grafik hinter dem Text, Bilder und Wörter
 * sind fest auf der Seite platziert und lassen sich in Word austauschen.
 */
(function (root) {
  "use strict";

  var D = root.docx;
  var TWIP = 20;        // twips pro Punkt
  var PX = 96 / 72;     // Pixel (96 dpi) pro Punkt

  // Abstand Rahmen-Oberkante bis Grundlinie, als Anteil der Schriftgröße
  var GRUNDLINIE = { punkt: 1.024, normal: 0.946, fett: 0.959 };
  var ZEILE = { punkt: 1.28, normal: 1.2, fett: 1.2 };

  function bytes(b64) {
    var bin = atob(b64);
    var a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }

  function dataUrlInfo(url) {
    var m = /^data:image\/([a-z+]+);base64,(.*)$/i.exec(url || "");
    if (!m) return null;
    var typ = m[1].toLowerCase();
    if (typ === "jpeg") typ = "jpg";
    return { typ: typ, daten: bytes(m[2]) };
  }

  function bildLaden(src) {
    return new Promise(function (ok, fehler) {
      var img = new Image();
      img.onload = function () { ok(img); };
      img.onerror = fehler;
      img.src = src;
    });
  }

  // Bilder, die Word nicht kennt (z. B. WebP), als PNG
  function alsWordBild(src) {
    var info = dataUrlInfo(src);
    if (info && (info.typ === "png" || info.typ === "jpg" || info.typ === "gif")) {
      return bildLaden(src).then(function (img) { return { info: info, img: img }; });
    }
    return bildLaden(src).then(function (img) {
      var c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d").drawImage(img, 0, 0);
      return { info: dataUrlInfo(c.toDataURL("image/png")), img: img };
    });
  }

  function hintergrundPng(svgText, dpi) {
    var b = Math.round(root.Layout.SEITE.b / 72 * dpi);
    var h = Math.round(root.Layout.SEITE.h / 72 * dpi);
    var url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText);
    return bildLaden(url).then(function (img) {
      var c = document.createElement("canvas");
      c.width = b;
      c.height = h;
      var ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, b, h);
      return dataUrlInfo(c.toDataURL("image/png")).daten;
    });
  }

  function schwebend(x, y, hinten) {
    return {
      horizontalPosition: { relative: D.HorizontalPositionRelativeFrom.PAGE, offset: Math.round(x * 12700) },
      verticalPosition: { relative: D.VerticalPositionRelativeFrom.PAGE, offset: Math.round(y * 12700) },
      behindDocument: !!hinten,
      allowOverlap: true,
      lockAnchor: true,
      wrap: { type: D.TextWrappingType.NONE },
    };
  }

  function textAbsatz(e) {
    var S = root.Layout.SCHRIFT[e.schrift];
    var halbpunkte = Math.round(e.groesse * 2);
    var groesse = halbpunkte / 2;
    var zeile = groesse * ZEILE[e.schrift];
    var oben = e.grundlinie - groesse * GRUNDLINIE[e.schrift];
    // etwas breiter als nötig, damit Word nie umbricht (Text steht linksbündig)
    var breite = e.kastenB ? e.kastenB + 40 : (e.rolle === "titel" ? e.breite + 40 : 480);
    var x = e.anker === "mitte" ? e.x - breite / 2 : e.x;
    return new D.Paragraph({
      frame: {
        type: "absolute",
        position: { x: Math.round(x * TWIP), y: Math.round(oben * TWIP) },
        width: Math.round(breite * TWIP),
        height: Math.round(zeile * TWIP),
        rule: D.HeightRule.EXACT,
        anchor: { horizontal: D.FrameAnchorType.PAGE, vertical: D.FrameAnchorType.PAGE },
        wrap: D.FrameWrap.NONE,
        anchorLock: true,
      },
      alignment: e.anker === "mitte" ? D.AlignmentType.CENTER : D.AlignmentType.LEFT,
      spacing: { before: 0, after: 0, line: Math.round(zeile * TWIP), lineRule: D.LineRuleType.EXACT },
      children: e.teile.map(function (t) {
        return new D.TextRun({
          text: t.text,
          font: S.familie,
          bold: S.gewicht === 700,
          size: halbpunkte,
          color: (t.farbe || "#000000").replace("#", ""),
          characterSpacing: Math.round((t.abstand != null ? t.abstand : e.abstand) * TWIP),
        });
      }),
    });
  }

  function bildLauf(e) {
    return alsWordBild(e.src).then(function (r) {
      // wie "contain": Seitenverhältnis behalten, im Feld zentrieren
      var f = Math.min(e.b / r.img.naturalWidth, e.h / r.img.naturalHeight);
      var b = r.img.naturalWidth * f;
      var h = r.img.naturalHeight * f;
      return new D.ImageRun({
        type: r.info.typ,
        data: r.info.daten,
        transformation: { width: b * PX, height: h * PX },
        floating: schwebend(e.x + (e.b - b) / 2, e.y + (e.h - h) / 2, false),
        altText: { name: e.rolle === "titelbild" ? "Titelbild" : "Bild", description: "", title: "" },
      });
    });
  }

  function seiteBauen(seite, erste) {
    var L = root.Layout;
    var statisch = L.svg(seite, true);
    var hatStatisch = seite.elemente.some(L.istStatisch);
    var bilder = seite.elemente.filter(function (e) { return e.art === "bild"; });
    var texte = seite.elemente.filter(function (e) { return e.art === "text"; });

    var hintergrund = hatStatisch
      ? hintergrundPng(statisch, 200).then(function (png) {
        return new D.ImageRun({
          type: "svg",
          data: new TextEncoder().encode(statisch),
          fallback: { type: "png", data: png },
          transformation: { width: L.SEITE.b * PX, height: L.SEITE.h * PX },
          floating: schwebend(0, 0, true),
          altText: { name: "Seitenrahmen", description: "", title: "" },
        });
      })
      : Promise.resolve(null);

    return Promise.all([hintergrund].concat(bilder.map(bildLauf))).then(function (laeufe) {
      var anker = new D.Paragraph({
        pageBreakBefore: !erste,
        spacing: { before: 0, after: 0, line: 20, lineRule: D.LineRuleType.EXACT },
        children: laeufe.filter(Boolean),
      });
      return [anker].concat(texte.map(textAbsatz));
    });
  }

  function erstelle(mappe) {
    var L = root.Layout;
    var seiten = L.seiten(mappe);
    var kette = Promise.resolve([]);
    seiten.forEach(function (s, i) {
      kette = kette.then(function (alle) {
        return seiteBauen(s, i === 0).then(function (abs) { return alle.concat(abs); });
      });
    });
    return kette.then(function (absaetze) {
      var S = root.SCHRIFTEN;
      var dok = new D.Document({
        creator: "",
        title: root.Silben.klartext(mappe.titel || ""),
        fonts: [
          { name: L.SCHRIFT.punkt.familie, data: bytes(S.punkt) },
          { name: L.SCHRIFT.normal.familie, data: bytes(S.normal), bold: bytes(S.fett) },
        ],
        styles: {
          default: { document: { run: { font: L.SCHRIFT.normal.familie, size: 24 } } },
        },
        sections: [{
          properties: {
            page: {
              size: { width: Math.round(L.SEITE.b * TWIP), height: Math.round(L.SEITE.h * TWIP) },
              margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0, gutter: 0 },
            },
          },
          children: absaetze,
        }],
      });
      return D.Packer.toBlob(dok);
    });
  }

  root.WordExport = { erstelle: erstelle };
})(window);
