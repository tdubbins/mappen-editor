(function () {
  "use strict";

  var $ = function (sel) { return document.querySelector(sel); };

  var mappe = null;

  // --- Speicher im Browser (IndexedDB, damit auch viele Bilder passen) -------

  var DB_NAME = "mappen-editor";
  var dbVersprechen = null;

  function db() {
    if (!dbVersprechen) {
      dbVersprechen = new Promise(function (ok, fehler) {
        var anfrage = indexedDB.open(DB_NAME, 1);
        anfrage.onupgradeneeded = function () { anfrage.result.createObjectStore("mappen"); };
        anfrage.onsuccess = function () { ok(anfrage.result); };
        anfrage.onerror = function () { fehler(anfrage.error); };
      });
    }
    return dbVersprechen;
  }

  // Manche Browser (privates Fenster, Dateien direkt geöffnet) antworten nie
  function mitZeitgrenze(versprechen, ms, ersatz) {
    return Promise.race([versprechen, new Promise(function (ok) { setTimeout(function () { ok(ersatz); }, ms); })]);
  }

  function dbLesen() {
    return mitZeitgrenze(db().then(function (d) {
      return new Promise(function (ok) {
        var a = d.transaction("mappen").objectStore("mappen").get("aktuell");
        a.onsuccess = function () { ok(a.result || null); };
        a.onerror = function () { ok(null); };
      });
    }).catch(function () { return null; }), 1500, null);
  }

  function dbSchreiben(wert) {
    return db().then(function (d) {
      return new Promise(function (ok, fehler) {
        var t = d.transaction("mappen", "readwrite");
        t.objectStore("mappen").put(wert, "aktuell");
        t.oncomplete = ok;
        t.onerror = function () { fehler(t.error); };
      });
    });
  }

  var speicherTimer = null;
  function spaeterSpeichern() {
    clearTimeout(speicherTimer);
    $("#speicher-status").textContent = "Wird gespeichert …";
    speicherTimer = setTimeout(function () {
      dbSchreiben(mappe).then(function () {
        $("#speicher-status").textContent = "Automatisch im Browser gespeichert. Zum Weitergeben oder Aufheben: „Mappe speichern“.";
      }).catch(function () {
        $("#speicher-status").textContent = "Konnte nicht automatisch speichern – bitte „Mappe speichern“ benutzen.";
      });
    }, 400);
  }

  // --- Hilfen --------------------------------------------------------------

  function neueId() {
    return "k" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function kopie(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function normalisiere(m) {
    m = m || {};
    return {
      version: 1,
      titel: m.titel || "",
      titelBild: m.titelBild || null,
      besitzerText: m.besitzerText != null ? m.besitzerText : "Diese Mappe gehört:",
      metacomHinweis: !!m.metacomHinweis,
      eintraege: (m.eintraege || []).map(function (e) {
        return {
          id: e.id || neueId(),
          wort: e.wort || "",
          bild: e.bild || null,
          bildQuelle: e.bildQuelle || null,
          layout: e.layout || "auto",
          bildGroesse: e.bildGroesse || 100,
          punktAbstand: typeof e.punktAbstand === "number" ? e.punktAbstand : undefined,
        };
      }),
    };
  }

  function meldung(text) {
    var m = $("#meldung");
    m.textContent = text;
    m.hidden = false;
    clearTimeout(meldung.t);
    meldung.t = setTimeout(function () { m.hidden = true; }, 3500);
  }

  function silbenHtml(wort) {
    var span = document.createDocumentFragment();
    Silben.silben(wort).forEach(function (t) {
      var s = document.createElement("span");
      if (t.silbe >= 0) s.className = "s" + (t.silbe % 2);
      s.textContent = t.text;
      span.appendChild(s);
    });
    return span;
  }

  function dateiname(text, endung) {
    var n = (text || "Mappe").replace(/[\\/:*?"<>|]+/g, "").trim() || "Mappe";
    return n + endung;
  }

  function herunterladen(blob, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // --- Vorschau ------------------------------------------------------------

  var vorschauGeplant = false;
  function vorschauAktualisieren() {
    if (vorschauGeplant) return;
    vorschauGeplant = true;
    setTimeout(function () {
      vorschauGeplant = false;
      var ziel = $("#vorschau");
      var seiten = Layout.seiten(mappe);
      var html = "";
      seiten.forEach(function (s, i) {
        html += '<div class="seite-nr">Seite ' + (i + 1) + " von " + seiten.length + "</div>";
        html += '<div class="seite">' + Layout.svg(s) + "</div>";
      });
      ziel.innerHTML = html;
    }, 0);
  }

  function geaendert() {
    vorschauAktualisieren();
    spaeterSpeichern();
  }

  // --- Deckblatt -----------------------------------------------------------

  function bildKnopfSetzen(knopf, src) {
    knopf.style.backgroundImage = src ? 'url("' + src + '")' : "";
    knopf.classList.toggle("hat-bild", !!src);
  }

  function deckblattZeigen() {
    $("#titel").value = mappe.titel;
    $("#besitzer").value = mappe.besitzerText;
    $("#metacom-hinweis").checked = mappe.metacomHinweis;
    bildKnopfSetzen($("#titel-bild"), mappe.titelBild);
    titelSilbenZeigen();
  }

  function titelSilbenZeigen() {
    var z = $("#titel-silben");
    z.textContent = "";
    z.appendChild(silbenHtml(mappe.titel));
  }

  // --- Kartenliste ---------------------------------------------------------

  function zaehlerZeigen() {
    var n = mappe.eintraege.length;
    var seiten = Math.ceil(n / 3) + 1;
    $("#zaehler").textContent = "(" + n + " Karten, " + seiten + " Seiten)";
  }

  function eintragNach(id) {
    return mappe.eintraege.find(function (e) { return e.id === id; });
  }

  function karteElement(e) {
    var li = document.createElement("li");
    li.className = "karte";
    li.dataset.id = e.id;
    li.innerHTML =
      '<div class="griff" draggable="true" title="Ziehen zum Verschieben">⋮⋮</div>' +
      '<button type="button" class="bild-knopf" title="Bild ändern"></button>' +
      '<div class="karte-felder">' +
      '  <input type="text" class="wort" placeholder="Wort eingeben" autocomplete="off" spellcheck="true">' +
      '  <div class="silben-vorschau"></div>' +
      '  <div class="karte-unten">' +
      '    <select class="layout" title="Kartenform">' +
      '      <option value="auto">Form: automatisch</option>' +
      '      <option value="normal">Form: normal</option>' +
      '      <option value="breit">Form: breit</option>' +
      "    </select>" +
      '    <select class="groesse" title="Bildgröße">' +
      '      <option value="60">Bild 60 %</option><option value="70">Bild 70 %</option>' +
      '      <option value="80">Bild 80 %</option><option value="90">Bild 90 %</option>' +
      '      <option value="100">Bild 100 %</option>' +
      "    </select>" +
      "  </div>" +
      "</div>" +
      '<div class="karte-aktionen">' +
      '  <button type="button" class="hoch" title="Nach oben">↑</button>' +
      '  <button type="button" class="runter" title="Nach unten">↓</button>' +
      '  <button type="button" class="loeschen" title="Karte löschen">×</button>' +
      "</div>";
    li.querySelector(".wort").value = e.wort;
    li.querySelector(".layout").value = e.layout;
    li.querySelector(".groesse").value = String(e.bildGroesse);
    bildKnopfSetzen(li.querySelector(".bild-knopf"), e.bild);
    li.querySelector(".silben-vorschau").appendChild(silbenHtml(e.wort));
    return li;
  }

  function listeZeigen() {
    var ol = $("#karten");
    ol.textContent = "";
    mappe.eintraege.forEach(function (e) { ol.appendChild(karteElement(e)); });
    zaehlerZeigen();
  }

  function verschieben(id, neuIndex) {
    var alt = mappe.eintraege.findIndex(function (e) { return e.id === id; });
    if (alt < 0) return;
    var e = mappe.eintraege.splice(alt, 1)[0];
    if (neuIndex > alt) neuIndex--;
    neuIndex = Math.max(0, Math.min(mappe.eintraege.length, neuIndex));
    mappe.eintraege.splice(neuIndex, 0, e);
    listeZeigen();
    geaendert();
  }

  function listeEinrichten() {
    var ol = $("#karten");

    ol.addEventListener("input", function (ev) {
      var li = ev.target.closest(".karte");
      if (!li || !ev.target.classList.contains("wort")) return;
      var e = eintragNach(li.dataset.id);
      e.wort = ev.target.value;
      delete e.punktAbstand;
      var sv = li.querySelector(".silben-vorschau");
      sv.textContent = "";
      sv.appendChild(silbenHtml(e.wort));
      geaendert();
    });

    ol.addEventListener("change", function (ev) {
      var li = ev.target.closest(".karte");
      if (!li) return;
      var e = eintragNach(li.dataset.id);
      if (ev.target.classList.contains("layout")) e.layout = ev.target.value;
      if (ev.target.classList.contains("groesse")) e.bildGroesse = +ev.target.value;
      geaendert();
    });

    ol.addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter" || !ev.target.classList.contains("wort")) return;
      ev.preventDefault();
      var li = ev.target.closest(".karte");
      var naechste = li.nextElementSibling;
      if (naechste) {
        naechste.querySelector(".wort").focus();
      } else {
        karteHinzufuegen();
      }
    });

    ol.addEventListener("click", function (ev) {
      var li = ev.target.closest(".karte");
      if (!li) return;
      var id = li.dataset.id;
      var index = mappe.eintraege.findIndex(function (e) { return e.id === id; });
      if (ev.target.closest(".bild-knopf")) {
        bildDialogOeffnen(id);
      } else if (ev.target.closest(".hoch")) {
        if (index > 0) verschieben(id, index - 1);
      } else if (ev.target.closest(".runter")) {
        if (index < mappe.eintraege.length - 1) verschieben(id, index + 2);
      } else if (ev.target.closest(".loeschen")) {
        var e = mappe.eintraege[index];
        if (!confirm("Karte „" + (Silben.klartext(e.wort) || "ohne Wort") + "“ löschen?")) return;
        mappe.eintraege.splice(index, 1);
        li.remove();
        zaehlerZeigen();
        geaendert();
      }
    });

    // Ziehen und Ablegen
    var gezogen = null;
    ol.addEventListener("dragstart", function (ev) {
      var li = ev.target.closest(".karte");
      if (!li) return;
      gezogen = li.dataset.id;
      li.classList.add("zieht");
      ev.dataTransfer.effectAllowed = "move";
      ev.dataTransfer.setData("text/plain", gezogen);
      ev.dataTransfer.setDragImage(li, 20, 20);
    });
    function zielMarkierungWeg() {
      ol.querySelectorAll(".ziel-oben, .ziel-unten").forEach(function (x) {
        x.classList.remove("ziel-oben", "ziel-unten");
      });
    }
    ol.addEventListener("dragover", function (ev) {
      if (!gezogen) return;
      var li = ev.target.closest(".karte");
      if (!li) return;
      ev.preventDefault();
      zielMarkierungWeg();
      var r = li.getBoundingClientRect();
      li.classList.add(ev.clientY < r.top + r.height / 2 ? "ziel-oben" : "ziel-unten");
    });
    ol.addEventListener("drop", function (ev) {
      if (!gezogen) return;
      var li = ev.target.closest(".karte");
      ev.preventDefault();
      if (li) {
        var index = mappe.eintraege.findIndex(function (e) { return e.id === li.dataset.id; });
        if (li.classList.contains("ziel-unten")) index++;
        verschieben(gezogen, index);
      }
      gezogen = null;
      zielMarkierungWeg();
    });
    ol.addEventListener("dragend", function () {
      gezogen = null;
      zielMarkierungWeg();
      ol.querySelectorAll(".zieht").forEach(function (x) { x.classList.remove("zieht"); });
    });

    // Bilder von außen (z. B. aus MetaSearch) direkt auf eine Karte ziehen
    function bildZielWeg() {
      ol.querySelectorAll(".bild-ziel").forEach(function (x) { x.classList.remove("bild-ziel"); });
    }
    ol.addEventListener("dragover", function (ev) {
      if (gezogen || !vonAussen(ev)) return;
      var li = ev.target.closest(".karte");
      if (!li) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "copy";
      if (!li.classList.contains("bild-ziel")) {
        bildZielWeg();
        li.classList.add("bild-ziel");
      }
    });
    ol.addEventListener("dragleave", function (ev) {
      if (!ol.contains(ev.relatedTarget)) bildZielWeg();
    });
    ol.addEventListener("drop", function (ev) {
      if (gezogen || !vonAussen(ev)) return;
      var li = ev.target.closest(".karte");
      bildZielWeg();
      if (!li) return;
      ev.preventDefault();
      bildUebernehmen(bildAusUebergabe(ev.dataTransfer), li.dataset.id);
    });
  }

  function karteHinzufuegen() {
    var e = { id: neueId(), wort: "", bild: null, bildQuelle: null, layout: "auto", bildGroesse: 100 };
    mappe.eintraege.push(e);
    var li = karteElement(e);
    $("#karten").appendChild(li);
    zaehlerZeigen();
    geaendert();
    li.querySelector(".wort").focus();
    li.scrollIntoView({ block: "nearest" });
  }

  // --- Bild-Dialog -----------------------------------------------------------

  var bildZiel = null; // Karten-ID oder "titel"

  function bildSetzen(src, quelle, ziel) {
    if (ziel === undefined) ziel = bildZiel;
    if (quelle === "metacom" && !mappe.metacomHinweis) {
      mappe.metacomHinweis = true;
      $("#metacom-hinweis").checked = true;
    }
    if (ziel === "titel") {
      mappe.titelBild = src;
      bildKnopfSetzen($("#titel-bild"), src);
    } else {
      var e = eintragNach(ziel);
      if (!e) return;
      e.bild = src;
      e.bildQuelle = src ? quelle : null;
      var li = document.querySelector('.karte[data-id="' + ziel + '"]');
      if (li) bildKnopfSetzen(li.querySelector(".bild-knopf"), src);
    }
    geaendert();
    if ($("#bild-dialog").open) $("#bild-dialog").close();
  }

  // --- Bilder aus Ziehen & Ablegen oder Zwischenablage ---------------------

  function vonAussen(ev) {
    var typen = Array.from((ev.dataTransfer && ev.dataTransfer.types) || []);
    return typen.indexOf("Files") >= 0 || typen.indexOf("text/uri-list") >= 0 || typen.indexOf("text/html") >= 0;
  }

  function istBildDatei(d) {
    return d && /^image\//.test(d.type);
  }

  // Liest das Bild aus einem Ziehen/Ablegen. getData geht nur sofort im Ereignis.
  function bildAusUebergabe(dt) {
    var datei = Array.from(dt.files || []).find(istBildDatei);
    if (datei) return Promise.resolve(datei);
    var url = null;
    var html = dt.getData("text/html");
    var m = html && /<img[^>]+src\s*=\s*["']([^"']+)["']/i.exec(html);
    if (m) url = m[1].replace(/&amp;/g, "&");
    if (!url) {
      url = (dt.getData("text/uri-list") || "").split(/\r?\n/).find(function (z) { return z && z.charAt(0) !== "#"; }) || null;
    }
    if (!url || /^file:/i.test(url)) return Promise.reject(new Error("kein Bild"));
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.blob();
    }).then(function (b) {
      if (!istBildDatei(b)) throw new Error("kein Bild");
      return b;
    });
  }

  function bildUebernehmen(versprechen, ziel) {
    return versprechen
      .then(bildVorbereiten)
      .then(function (url) {
        if (!url) throw new Error("Bild");
        bildSetzen(url, "eigenes", ziel);
      })
      .catch(function () {
        meldung("Das Bild konnte nicht übernommen werden. Tipp: in MetaSearch kopieren, ins Wortfeld klicken, ⌘V.");
      });
  }

  function reiterZeigen(name) {
    document.querySelectorAll(".dialog-reiter button").forEach(function (b) {
      b.classList.toggle("aktiv", b.dataset.reiter === name);
    });
    document.querySelectorAll(".reiter-inhalt").forEach(function (d) {
      d.hidden = d.dataset.inhalt !== name;
    });
  }

  function bildDialogOeffnen(ziel) {
    bildZiel = ziel;
    var suchwort = ziel === "titel" ? Silben.klartext(mappe.titel) : Silben.klartext((eintragNach(ziel) || {}).wort);
    $("#suche-text").value = suchwort || "";
    $("#treffer").textContent = "";
    reiterZeigen("suche");
    letzterZustand = window.Metacom.zustand;
    metacomLeisteZeigen();
    $("#bild-dialog").showModal();
    // Der Klick aufs Bildfeld zählt als Erlaubnis-Klick für den gemerkten Ordner
    if (window.Metacom.zustand === "freigabe") window.Metacom.freigeben();
    if (suchwort) suchen(suchwort);
    else $("#suche-text").focus();
  }

  // --- METACOM-Ordner ------------------------------------------------------

  var metacomTreffer = [];
  var metacomUrls = [];

  function zahl(n) {
    return n.toLocaleString("de-DE");
  }

  function metacomLeisteZeigen() {
    var l = $("#metacom-leiste");
    var M = window.Metacom;
    var name = M.ordnerName ? "„" + M.ordnerName + "“" : "";
    l.textContent = "";
    function text(t) { var s = document.createElement("span"); s.textContent = t; l.appendChild(s); }
    function knopf(t, aktion) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = t;
      b.dataset.metacomAktion = aktion;
      l.appendChild(b);
    }
    switch (M.zustand) {
      case "bereit":
        text("METACOM: " + zahl(M.anzahl) + " Symbole aus " + name);
        knopf("Anderen Ordner wählen", "verbinden");
        break;
      case "liest":
        text("METACOM-Ordner wird gelesen … " + zahl(M.anzahl) + " Symbole");
        break;
      case "freigabe":
        text("METACOM-Ordner " + name + " ist gemerkt.");
        knopf("Freigeben", "freigeben");
        break;
      case "fehler":
        text("Im Ordner " + name + " wurden keine Bilder gefunden.");
        knopf("Anderen Ordner wählen", "verbinden");
        break;
      default:
        text(M.ordnerName && !M.kannMerken
          ? "METACOM-Ordner " + name + " bitte noch einmal wählen:"
          : "METACOM-Symbole hier mitsuchen:");
        knopf("METACOM-Ordner wählen …", "verbinden");
    }
  }

  var letzterZustand = null;
  function metacomGeaendert() {
    if (!$("#bild-dialog").open) return;
    metacomLeisteZeigen();
    var z = window.Metacom.zustand;
    if (z === "bereit" && letzterZustand !== "bereit") {
      var t = $("#suche-text").value.trim();
      if (t) suchen(t);
    }
    letzterZustand = z;
  }

  function metacomTrefferZeigen(ziel, text) {
    metacomUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    metacomUrls = [];
    metacomTreffer = window.Metacom.suchen(text, 60);
    if (window.Metacom.zustand !== "bereit") return;
    var kopf = document.createElement("div");
    kopf.className = "abschnitt";
    kopf.textContent = metacomTreffer.length ? "METACOM" : "METACOM: nichts gefunden";
    ziel.appendChild(kopf);
    metacomTreffer.forEach(function (sym, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "metacom";
      b.title = sym.pfad;
      b.dataset.metacom = i;
      var img = document.createElement("img");
      img.alt = sym.name;
      var unter = document.createElement("span");
      unter.textContent = sym.name;
      b.appendChild(img);
      b.appendChild(unter);
      ziel.appendChild(b);
      sym.holen().then(function (d) {
        var u = URL.createObjectURL(d);
        metacomUrls.push(u);
        img.src = u;
      }).catch(function () { b.remove(); });
    });
  }

  var sucheNr = 0;
  function suchen(text) {
    var nr = ++sucheNr;
    var ziel = $("#treffer");
    ziel.textContent = "";
    metacomTrefferZeigen(ziel, text);
    if (window.Metacom.zustand === "bereit") {
      var kopf = document.createElement("div");
      kopf.className = "abschnitt";
      kopf.textContent = "ARASAAC";
      ziel.appendChild(kopf);
    }
    var status = document.createElement("div");
    status.className = "leer";
    status.textContent = "Suche läuft …";
    ziel.appendChild(status);
    fetch("https://api.arasaac.org/v1/pictograms/de/search/" + encodeURIComponent(text.trim()))
      .then(function (r) {
        if (r.status === 404) return [];
        if (!r.ok) throw new Error(r.status);
        return r.json();
      })
      .then(function (liste) {
        if (nr !== sucheNr) return;
        if (!liste.length) {
          status.textContent = "Nichts gefunden. Anderes Wort versuchen (z. B. Einzahl: „Hund“ statt „Hunde“).";
          return;
        }
        status.remove();
        liste.slice(0, 60).forEach(function (p) {
          var b = document.createElement("button");
          b.type = "button";
          b.title = (p.keywords || []).map(function (k) { return k.keyword; }).join(", ");
          b.dataset.id = p._id;
          var img = document.createElement("img");
          img.loading = "lazy";
          img.alt = b.title;
          img.src = "https://static.arasaac.org/pictograms/" + p._id + "/" + p._id + "_300.png";
          b.appendChild(img);
          ziel.appendChild(b);
        });
      })
      .catch(function () {
        if (nr !== sucheNr) return;
        status.textContent = "Keine Verbindung zu ARASAAC. Ist das Internet an? Alternativ unter „Eigenes Bild“ ein Bild einfügen.";
      });
  }

  function alsDataUrl(blob) {
    return new Promise(function (ok, fehler) {
      var r = new FileReader();
      r.onload = function () { ok(r.result); };
      r.onerror = fehler;
      r.readAsDataURL(blob);
    });
  }

  // Leere (durchsichtige oder weiße) Ränder abschneiden, damit das Bild das
  // Bildfeld gut ausfüllt, und große Fotos verkleinern
  function bildVorbereiten(blob) {
    return alsDataUrl(blob).then(function (url) {
      return new Promise(function (ok) {
        var img = new Image();
        img.onload = function () {
          var w = img.naturalWidth;
          var h = img.naturalHeight;
          var c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          var ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0);
          var px;
          try {
            px = ctx.getImageData(0, 0, w, h).data;
          } catch (f) {
            return ok(url);
          }
          var x0 = w, y0 = h, x1 = -1, y1 = -1;
          for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
              var i = (y * w + x) * 4;
              var leer = px[i + 3] < 16 || (px[i] > 245 && px[i + 1] > 245 && px[i + 2] > 245);
              if (!leer) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
              }
            }
          }
          if (x1 < 0) return ok(url);
          var rand = Math.round(Math.max(x1 - x0, y1 - y0) * 0.02);
          x0 = Math.max(0, x0 - rand);
          y0 = Math.max(0, y0 - rand);
          x1 = Math.min(w - 1, x1 + rand);
          y1 = Math.min(h - 1, y1 + rand);
          var bw = x1 - x0 + 1;
          var bh = y1 - y0 + 1;
          var max = 1000;
          var f = Math.min(1, max / Math.max(bw, bh));
          var gif = /^data:image\/gif/.test(url);
          var webp = /^data:image\/webp/.test(url);
          if (bw === w && bh === h && f === 1 && !gif && !webp) return ok(url);
          var z = document.createElement("canvas");
          z.width = Math.round(bw * f);
          z.height = Math.round(bh * f);
          z.getContext("2d").drawImage(c, x0, y0, bw, bh, 0, 0, z.width, z.height);
          var jpeg = /^data:image\/jpe?g/.test(url);
          ok(jpeg ? z.toDataURL("image/jpeg", 0.9) : z.toDataURL("image/png"));
        };
        img.onerror = function () { ok(null); };
        img.src = url;
      });
    });
  }

  function dialogEinrichten() {
    $("#suche-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var t = $("#suche-text").value.trim();
      if (t) suchen(t);
    });

    $("#treffer").addEventListener("click", function (ev) {
      var mb = ev.target.closest("button[data-metacom]");
      if (mb) {
        var sym = metacomTreffer[+mb.dataset.metacom];
        if (!sym) return;
        mb.disabled = true;
        sym.holen()
          .then(bildVorbereiten)
          .then(function (url) {
            if (!url) throw new Error("Bild");
            bildSetzen(url, "metacom");
          })
          .catch(function () {
            mb.disabled = false;
            meldung("Dieses Symbol konnte nicht gelesen werden.");
          });
        return;
      }
      var b = ev.target.closest("button[data-id]");
      if (!b) return;
      var id = b.dataset.id;
      b.disabled = true;
      fetch("https://static.arasaac.org/pictograms/" + id + "/" + id + "_500.png")
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.blob(); })
        .then(bildVorbereiten)
        .then(function (url) {
          if (!url) throw new Error("Bild");
          bildSetzen(url, "arasaac");
        })
        .catch(function () {
          b.disabled = false;
          meldung("Das Bild konnte nicht geladen werden.");
        });
    });

    $("#metacom-leiste").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-metacom-aktion]");
      if (!b) return;
      if (b.dataset.metacomAktion === "freigeben") window.Metacom.freigeben();
      else window.Metacom.verbinden();
    });
    window.Metacom.beobachten(metacomGeaendert);

    document.querySelectorAll(".dialog-reiter button").forEach(function (b) {
      b.addEventListener("click", function () { reiterZeigen(b.dataset.reiter); });
    });

    function dateiNehmen(datei) {
      if (!datei || !/^image\//.test(datei.type)) {
        meldung("Bitte eine Bilddatei (PNG, JPG, GIF) wählen.");
        return;
      }
      bildVorbereiten(datei).then(function (url) {
        if (url) bildSetzen(url, "eigenes");
        else meldung("Dieses Bild kann nicht gelesen werden.");
      });
    }

    $("#bild-datei").addEventListener("change", function (ev) {
      dateiNehmen(ev.target.files[0]);
      ev.target.value = "";
    });

    var ablage = $("#ablage");
    ["dragenter", "dragover"].forEach(function (t) {
      ablage.addEventListener(t, function (ev) { ev.preventDefault(); ablage.classList.add("drueber"); });
    });
    ["dragleave", "drop"].forEach(function (t) {
      ablage.addEventListener(t, function () { ablage.classList.remove("drueber"); });
    });
    var dialog = $("#bild-dialog");
    dialog.addEventListener("dragover", function (ev) {
      if (vonAussen(ev)) ev.preventDefault();
    });
    dialog.addEventListener("drop", function (ev) {
      if (!vonAussen(ev)) return;
      ev.preventDefault();
      bildUebernehmen(bildAusUebergabe(ev.dataTransfer));
    });

    // Daneben fallen gelassene Bilder sollen nicht die Seite verlassen
    document.addEventListener("dragover", function (ev) { if (vonAussen(ev)) ev.preventDefault(); });
    document.addEventListener("drop", function (ev) { if (vonAussen(ev)) ev.preventDefault(); });

    document.addEventListener("paste", function (ev) {
      var items = Array.from(ev.clipboardData.items || []);
      var item = items.find(function (i) { return /^image\//.test(i.type); });
      if (!item) return;
      if ($("#bild-dialog").open) {
        ev.preventDefault();
        dateiNehmen(item.getAsFile());
        return;
      }
      // Im Wortfeld einer Karte oder im Titel: Bild für diese Karte.
      // Nur wenn kein Text dabei ist (Word legt zu kopiertem Text oft ein Bild dazu).
      if (items.some(function (i) { return i.type === "text/plain"; })) return;
      var feld = document.activeElement;
      var li = feld && feld.closest && feld.closest(".karte");
      var ziel = li ? li.dataset.id : (feld && feld.id === "titel" ? "titel" : null);
      if (!ziel) return;
      ev.preventDefault();
      bildUebernehmen(Promise.resolve(item.getAsFile()), ziel);
    });

    $("#bild-entfernen").addEventListener("click", function () { bildSetzen(null, null); });
  }

  // --- Mappen laden / speichern -------------------------------------------

  function mappeSetzen(m) {
    mappe = normalisiere(m);
    deckblattZeigen();
    listeZeigen();
    geaendert();
  }

  function vorlagenMenue() {
    var liste = $("#vorlagen-liste");
    (window.VORLAGEN || []).forEach(function (v, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = v.name;
      b.dataset.vorlage = i;
      liste.appendChild(b);
    });
    var menue = $("#menue-neu");
    $("#knopf-neu").addEventListener("click", function (ev) {
      ev.stopPropagation();
      menue.hidden = !menue.hidden;
    });
    document.addEventListener("click", function () { menue.hidden = true; });
    menue.addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b) return;
      if (!confirm("Die aktuelle Mappe wird ersetzt. Vorher „Mappe speichern“, wenn sie noch gebraucht wird.\n\nWeiter?")) return;
      if (b.dataset.aktion === "leer") {
        mappeSetzen({ titel: "", eintraege: [{ wort: "" }, { wort: "" }, { wort: "" }] });
        $("#titel").focus();
      } else {
        mappeSetzen(kopie(window.VORLAGEN[+b.dataset.vorlage].mappe));
      }
      menue.hidden = true;
    });
  }

  function speichernEinrichten() {
    $("#knopf-speichern").addEventListener("click", function () {
      var blob = new Blob([JSON.stringify(mappe)], { type: "application/json" });
      herunterladen(blob, dateiname(Silben.klartext(mappe.titel), ".mappe.json"));
      meldung("Die Mappe wurde als Datei gespeichert (Ordner „Downloads“).");
    });

    $("#knopf-oeffnen").addEventListener("click", function () { $("#datei-oeffnen").click(); });
    $("#datei-oeffnen").addEventListener("change", function (ev) {
      var datei = ev.target.files[0];
      ev.target.value = "";
      if (!datei) return;
      datei.text().then(function (t) {
        var m = JSON.parse(t);
        if (!m || !Array.isArray(m.eintraege)) throw new Error("kein Mappen-Format");
        mappeSetzen(m);
        meldung("„" + Silben.klartext(m.titel || "Mappe") + "“ geöffnet.");
      }).catch(function () {
        meldung("Diese Datei ist keine gespeicherte Mappe.");
      });
    });

    $("#knopf-drucken").addEventListener("click", function () { window.print(); });

    $("#knopf-word").addEventListener("click", function () {
      var knopf = $("#knopf-word");
      knopf.disabled = true;
      knopf.textContent = "Word-Datei wird erstellt …";
      WordExport.erstelle(mappe)
        .then(function (blob) {
          herunterladen(blob, dateiname(Silben.klartext(mappe.titel), ".docx"));
          meldung("Die Word-Datei liegt im Ordner „Downloads“.");
        })
        .catch(function (f) {
          console.error(f);
          meldung("Die Word-Datei konnte nicht erstellt werden.");
        })
        .then(function () {
          knopf.disabled = false;
          knopf.textContent = "Als Word herunterladen";
        });
    });
  }

  function deckblattEinrichten() {
    $("#titel").addEventListener("input", function (ev) {
      mappe.titel = ev.target.value;
      titelSilbenZeigen();
      geaendert();
    });
    $("#besitzer").addEventListener("input", function (ev) {
      mappe.besitzerText = ev.target.value;
      geaendert();
    });
    $("#metacom-hinweis").addEventListener("change", function (ev) {
      mappe.metacomHinweis = ev.target.checked;
      geaendert();
    });
    var titelBild = $("#titel-bild");
    titelBild.addEventListener("click", function () { bildDialogOeffnen("titel"); });
    titelBild.addEventListener("dragover", function (ev) {
      if (!vonAussen(ev)) return;
      ev.preventDefault();
      titelBild.classList.add("bild-ziel");
    });
    titelBild.addEventListener("dragleave", function () { titelBild.classList.remove("bild-ziel"); });
    titelBild.addEventListener("drop", function (ev) {
      if (!vonAussen(ev)) return;
      ev.preventDefault();
      ev.stopPropagation();
      titelBild.classList.remove("bild-ziel");
      bildUebernehmen(bildAusUebergabe(ev.dataTransfer), "titel");
    });
    $("#knopf-hinzufuegen").addEventListener("click", karteHinzufuegen);
  }

  // --- Start ---------------------------------------------------------------

  Layout.ladeSchriften()
    .then(dbLesen)
    .then(function (gespeichert) {
      listeEinrichten();
      dialogEinrichten();
      vorlagenMenue();
      speichernEinrichten();
      deckblattEinrichten();
      window.Metacom.start();
      var start = gespeichert || (window.VORLAGEN && window.VORLAGEN[0] && kopie(window.VORLAGEN[0].mappe)) || {};
      mappe = normalisiere(start);
      deckblattZeigen();
      listeZeigen();
      vorschauAktualisieren();
      if (!gespeichert) spaeterSpeichern();
      else $("#speicher-status").textContent = "Automatisch im Browser gespeichert. Zum Weitergeben oder Aufheben: „Mappe speichern“.";
    })
    .catch(function (f) {
      console.error(f);
      $("#vorschau").textContent = "Der Editor konnte nicht starten: " + (f && f.message ? f.message : f);
    });
})();
