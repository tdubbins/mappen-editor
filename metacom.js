/*
 * METACOM-Symbole aus einem Ordner auf dem eigenen Rechner.
 * Der Ordner wird nur gelesen; nichts davon verlässt den Computer.
 * In Chrome/Edge merkt sich der Browser den Ordner, in anderen Browsern
 * muss er nach dem Neuladen noch einmal gewählt werden.
 */
(function (root) {
  "use strict";

  var ENDUNG = /\.(png|jpe?g|gif|webp|svg)$/i;
  var DB_NAME = "mappen-editor-metacom";

  var symbole = [];       // { name, pfad, schluessel, holen }
  var ordnerName = "";
  var griff = null;       // FileSystemDirectoryHandle (nur Chrome/Edge)
  var zustand = "leer";   // leer | freigabe | liest | bereit | fehler
  var gelesen = 0;
  var beobachter = [];

  var kannMerken = typeof root.showDirectoryPicker === "function";

  function melden() {
    beobachter.forEach(function (f) { f(); });
  }

  function setze(z) {
    zustand = z;
    melden();
  }

  // --- gemerkter Ordner ----------------------------------------------------

  var dbVersprechen = null;
  function db() {
    if (!dbVersprechen) {
      dbVersprechen = new Promise(function (ok, fehler) {
        var a = indexedDB.open(DB_NAME, 1);
        a.onupgradeneeded = function () { a.result.createObjectStore("ordner"); };
        a.onsuccess = function () { ok(a.result); };
        a.onerror = function () { fehler(a.error); };
      });
    }
    return dbVersprechen;
  }

  function griffLesen() {
    return db().then(function (d) {
      return new Promise(function (ok) {
        var a = d.transaction("ordner").objectStore("ordner").get("metacom");
        a.onsuccess = function () { ok(a.result || null); };
        a.onerror = function () { ok(null); };
      });
    }).catch(function () { return null; });
  }

  function griffSchreiben(h) {
    return db().then(function (d) {
      return new Promise(function (ok) {
        var t = d.transaction("ordner", "readwrite");
        t.objectStore("ordner").put(h, "metacom");
        t.oncomplete = ok;
        t.onerror = function () { ok(); };
      });
    }).catch(function () {});
  }

  function nameMerken(name) {
    try { localStorage.setItem("metacom-ordner", name); } catch (f) { /* egal */ }
  }

  function gemerkterName() {
    try { return localStorage.getItem("metacom-ordner") || ""; } catch (f) { return ""; }
  }

  // --- Suchschlüssel -------------------------------------------------------

  // macOS liefert Dateinamen zerlegt (ä = a + ¨), daher zuerst NFC
  function schluessel(s) {
    return String(s).normalize("NFC").toLowerCase()
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .replace(/[_\-.,()]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function anzeigeName(datei) {
    return datei.normalize("NFC").replace(ENDUNG, "").replace(/_+/g, " ").trim();
  }

  function aufnehmen(name, pfad, holen) {
    if (!ENDUNG.test(name) || pfad.split("/").some(function (t) { return t.charAt(0) === "."; })) return;
    var anzeige = anzeigeName(name);
    symbole.push({ name: anzeige, pfad: pfad.normalize("NFC"), schluessel: schluessel(anzeige), holen: holen });
    gelesen++;
    if (gelesen % 500 === 0) melden();
  }

  // --- Ordner einlesen -----------------------------------------------------

  async function ordnerDurchgehen(ordner, pfad) {
    for await (var eintrag of ordner.values()) {
      if (eintrag.name.charAt(0) === ".") continue;
      if (eintrag.kind === "directory") {
        await ordnerDurchgehen(eintrag, pfad + eintrag.name + "/");
      } else {
        (function (h) {
          aufnehmen(h.name, pfad + h.name, function () { return h.getFile(); });
        })(eintrag);
      }
    }
  }

  async function griffEinlesen(h) {
    griff = h;
    ordnerName = h.name;
    symbole = [];
    gelesen = 0;
    setze("liest");
    try {
      await ordnerDurchgehen(h, "");
      setze(symbole.length ? "bereit" : "fehler");
    } catch (f) {
      console.error(f);
      setze("fehler");
    }
  }

  function dateienEinlesen(liste) {
    symbole = [];
    gelesen = 0;
    var erste = liste[0];
    ordnerName = erste && erste.webkitRelativePath ? erste.webkitRelativePath.split("/")[0] : "";
    nameMerken(ordnerName);
    Array.prototype.forEach.call(liste, function (d) {
      aufnehmen(d.name, d.webkitRelativePath || d.name, function () { return Promise.resolve(d); });
    });
    setze(symbole.length ? "bereit" : "fehler");
  }

  var dateiFeld = null;
  function dateiFeldHolen() {
    if (!dateiFeld) {
      dateiFeld = document.createElement("input");
      dateiFeld.type = "file";
      dateiFeld.multiple = true;
      dateiFeld.webkitdirectory = true;
      dateiFeld.hidden = true;
      dateiFeld.addEventListener("change", function () {
        if (dateiFeld.files.length) dateienEinlesen(dateiFeld.files);
        dateiFeld.value = "";
      });
      document.body.appendChild(dateiFeld);
    }
    return dateiFeld;
  }

  // Muss direkt aus einem Klick aufgerufen werden
  function verbinden() {
    if (!kannMerken) {
      dateiFeldHolen().click();
      return Promise.resolve();
    }
    return root.showDirectoryPicker({ id: "metacom", mode: "read" }).then(function (h) {
      griffSchreiben(h);
      nameMerken(h.name);
      return griffEinlesen(h);
    }).catch(function (f) {
      if (f && f.name === "AbortError") return;
      console.error(f);
      setze("fehler");
    });
  }

  // Erneute Leseerlaubnis für den gemerkten Ordner (ebenfalls aus einem Klick)
  function freigeben() {
    if (!griff) return verbinden();
    return griff.requestPermission({ mode: "read" }).then(function (r) {
      if (r === "granted") return griffEinlesen(griff);
      melden();
    }).catch(function () { melden(); });
  }

  function start() {
    ordnerName = gemerkterName();
    if (!kannMerken) return;
    griffLesen().then(function (h) {
      if (!h) return;
      griff = h;
      ordnerName = h.name;
      return h.queryPermission({ mode: "read" }).then(function (r) {
        if (r === "granted") return griffEinlesen(h);
        setze("freigabe");
      });
    }).catch(function () {});
  }

  // --- Suche ---------------------------------------------------------------

  function finde(q) {
    var t = [];
    symbole.forEach(function (s) {
      var k = s.schluessel;
      var rang;
      if (k === q) rang = 0;
      else if (k.indexOf(q + " ") === 0) rang = 1;
      else if (k.indexOf(q) === 0) rang = 2;
      else if ((" " + k).indexOf(" " + q) >= 0) rang = 3;
      else if (k.indexOf(q) > 0) rang = 4;
      else return;
      t.push({ s: s, rang: rang });
    });
    t.sort(function (a, b) {
      return a.rang - b.rang || a.s.schluessel.length - b.s.schluessel.length || a.s.pfad.localeCompare(b.s.pfad, "de");
    });
    return t.map(function (x) { return x.s; });
  }

  function suchen(text, max) {
    var q = schluessel(text || "");
    if (!q || zustand !== "bereit") return [];
    var t = finde(q);
    // Mehrzahl/Endungen: „Hunde“ → „Hund“, „Katzen“ → „Katze“
    if (!t.length) {
      var kurz = q.replace(/(en|er|n|e|s)$/, "");
      if (kurz.length >= 3 && kurz !== q) t = finde(kurz);
    }
    return t.slice(0, max || 60);
  }

  root.Metacom = {
    start: start,
    verbinden: verbinden,
    freigeben: freigeben,
    suchen: suchen,
    beobachten: function (f) { beobachter.push(f); },
    get zustand() { return zustand; },
    get anzahl() { return zustand === "liest" ? gelesen : symbole.length; },
    get ordnerName() { return ordnerName; },
    get kannMerken() { return kannMerken; },
    HINWEIS: "METACOM Symbole © Annette Kitzinger",
  };
})(window);
