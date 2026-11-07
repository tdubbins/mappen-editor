/*
 * Zerlegt Wörter in Sprechsilben (Fo-to-graf, A-po-the-ker, Bau-er).
 *
 * Die Trennmuster kennen Wortfugen (Schorn-stein, Schau-spie-ler), trennen
 * aber keine einzelnen Vokale ab. Darum werden sie mit einfachen
 * Sprechsilben-Regeln ergänzt.
 *
 * Bindestriche im eingegebenen Wort gelten immer als Silbengrenze
 * (z. B. "Fa-mi-li-e"), dann wird nichts automatisch getrennt.
 */
(function (root) {
  "use strict";

  var VOKALE = "aeiouäöüy";
  var DOPPELLAUTE = ["äu", "au", "ei", "ai", "eu", "ey", "ay", "ie", "aa", "ee", "oo", "ou"];
  // Endungen, bei denen "ie" zwei Silben sind: Fa-mi-li-e, Li-ni-e
  var IE_GETRENNT = /(ili|ini)e$/;
  // Buchstabengruppen, die wie ein einzelner Konsonant behandelt werden
  var KONSONANT_GRUPPEN = ["sch", "ch", "ck", "ph", "th", "qu"];
  // Konsonantenfolgen, die eine Silbe beginnen dürfen (nach Gruppen-Zerlegung)
  var ANLAUTE = [
    "bl", "br", "dr", "fl", "fr", "gl", "gr", "kl", "kn", "kr", "pl", "pr", "tr",
    "pf", "pfl", "pfr", "sch|l", "sch|m", "sch|n", "sch|r", "sch|w", "zw", "ph|r", "ph|l",
    "ch|r", "th|r", "qu",
  ];

  var trie = null;

  function baueTrie(text) {
    var t = {};
    text.split(/\s+/).forEach(function (p) {
      if (!p) return;
      var buchstaben = p.replace(/[0-9]/g, "");
      var werte = [];
      var i = 0;
      for (var k = 0; k < p.length; k++) {
        var c = p[k];
        if (c >= "0" && c <= "9") {
          werte[i] = +c;
        } else {
          i++;
        }
      }
      var knoten = t;
      for (var j = 0; j < buchstaben.length; j++) {
        var b = buchstaben[j];
        knoten = knoten[b] || (knoten[b] = {});
      }
      var voll = [];
      for (var n = 0; n <= buchstaben.length; n++) voll.push(werte[n] || 0);
      knoten._ = voll;
    });
    return t;
  }

  // Liang-Algorithmus: liefert Positionen i, an denen vor wort[i] getrennt werden darf
  function musterTrennungen(wort) {
    if (!trie) {
      if (!root.TRENNMUSTER_DE) return [];
      trie = baueTrie(root.TRENNMUSTER_DE);
    }
    var w = "." + wort + ".";
    var punkte = new Array(w.length + 1).fill(0);
    for (var i = 0; i < w.length; i++) {
      var knoten = trie;
      for (var j = i; j < w.length; j++) {
        knoten = knoten[w[j]];
        if (!knoten) break;
        if (knoten._) {
          for (var k = 0; k < knoten._.length; k++) {
            punkte[i + k] = Math.max(punkte[i + k], knoten._[k]);
          }
        }
      }
    }
    var ergebnis = [];
    for (var p = 1; p < wort.length; p++) {
      if (punkte[p + 1] % 2 === 1) ergebnis.push(p);
    }
    return ergebnis;
  }

  function istVokal(c) {
    return VOKALE.indexOf(c) >= 0;
  }

  // Vokalkerne als [start, ende) Paare
  function kerne(wort) {
    var out = [];
    var i = 0;
    while (i < wort.length) {
      if (!istVokal(wort[i])) {
        i++;
        continue;
      }
      // "qu": das u gehört zum Konsonanten
      if (wort[i] === "u" && i > 0 && wort[i - 1] === "q") {
        i++;
        continue;
      }
      // y vor einem Vokal am Wortanfang ist ein Konsonant (Yo-ga)
      if (wort[i] === "y" && i === 0 && wort.length > 1 && istVokal(wort[1])) {
        i++;
        continue;
      }
      var start = i;
      var paar = wort.substr(i, 2);
      var getrenntesIe = paar === "ie" && i === wort.length - 2 && IE_GETRENNT.test(wort);
      if (DOPPELLAUTE.indexOf(paar) >= 0 && !getrenntesIe) {
        i += 2;
      } else {
        i += 1;
      }
      out.push([start, i]);
    }
    return out;
  }

  // Zerlegt eine Konsonantenfolge in Einheiten ("sch", "ck", ...)
  function einheiten(folge) {
    var out = [];
    var i = 0;
    while (i < folge.length) {
      var treffer = null;
      for (var g = 0; g < KONSONANT_GRUPPEN.length; g++) {
        var gr = KONSONANT_GRUPPEN[g];
        if (folge.substr(i, gr.length) === gr) {
          treffer = gr;
          break;
        }
      }
      if (!treffer) treffer = folge[i];
      out.push(treffer);
      i += treffer.length;
    }
    return out;
  }

  function istAnlaut(teile) {
    if (teile.length === 1) return true;
    var einfach = teile.join("");
    var markiert = teile.join("|");
    return ANLAUTE.indexOf(einfach) >= 0 || ANLAUTE.indexOf(markiert) >= 0;
  }

  // Position (relativ zur Folge), an der die Folge nach den Regeln getrennt wird
  function regelTrennung(folge) {
    var teile = einheiten(folge);
    if (teile.length <= 1) return 0;
    // längster erlaubter Silbenanfang am Ende der Folge
    for (var n = Math.min(3, teile.length - 1); n >= 1; n--) {
      var anfang = teile.slice(teile.length - n);
      if (istAnlaut(anfang)) {
        return folge.length - anfang.join("").length;
      }
    }
    return folge.length - teile[teile.length - 1].length;
  }

  function trenneEinzelwort(wort) {
    if (wort.length < 2) return [wort];
    var klein = wort.toLowerCase();
    var muster = musterTrennungen(klein);
    var kernListe = kerne(klein);
    var grenzen = [];
    for (var k = 0; k + 1 < kernListe.length; k++) {
      var ende = kernListe[k][1];
      var start = kernListe[k + 1][0];
      var ausMuster = muster.filter(function (p) {
        return p >= ende && p <= start;
      });
      if (start === ende) {
        grenzen.push(start); // Vokal trifft Vokal: Bau-er, Si-o
      } else if (ausMuster.length) {
        grenzen.push(ausMuster[ausMuster.length - 1]);
      } else {
        grenzen.push(ende + regelTrennung(klein.slice(ende, start)));
      }
    }
    var silben = [];
    var letzte = 0;
    grenzen.forEach(function (g) {
      if (g > letzte && g < wort.length) {
        silben.push(wort.slice(letzte, g));
        letzte = g;
      }
    });
    silben.push(wort.slice(letzte));
    return silben;
  }

  /*
   * Gibt eine Liste von Teilen zurück: { text, silbe } für Silben und
   * { text, silbe: -1 } für Leerzeichen. "silbe" zählt pro Wort ab 0
   * (gerade = blau, ungerade = rot).
   */
  function silben(eingabe) {
    var text = String(eingabe || "");
    var teile = [];
    text.split(/(\s+)/).forEach(function (stueck) {
      if (!stueck) return;
      if (/^\s+$/.test(stueck)) {
        teile.push({ text: " ", silbe: -1 });
        return;
      }
      var liste;
      if (stueck.indexOf("-") >= 0) {
        liste = stueck.split("-").filter(Boolean);
      } else {
        // Satzzeichen am Rand nicht mittrennen
        var m = stueck.match(/^([^A-Za-zÄÖÜäöüß]*)(.*?)([^A-Za-zÄÖÜäöüß]*)$/);
        liste = trenneEinzelwort(m[2]);
        if (m[1]) liste[0] = m[1] + liste[0];
        if (m[3]) liste[liste.length - 1] += m[3];
      }
      liste.forEach(function (s, i) {
        teile.push({ text: s, silbe: i });
      });
    });
    return teile;
  }

  // Das Wort ohne Silben-Bindestriche (für Nachspur-Zeile)
  function klartext(eingabe) {
    return String(eingabe || "").replace(/-/g, "");
  }

  root.Silben = { silben: silben, klartext: klartext, trenne: trenneEinzelwort };
})(typeof window !== "undefined" ? window : globalThis);
