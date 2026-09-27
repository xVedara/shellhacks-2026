/* Path Guard mockups — local chrome only. No network, no product API. */
(function () {
  var root = document.documentElement;

  function theme() {
    return root.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function setTheme(next) {
    root.setAttribute("data-theme", next);
    try { sessionStorage.setItem("pg-theme", next); } catch (e) {}
    var url = new URL(location.href);
    url.searchParams.set("theme", next);
    history.replaceState(null, "", url.pathname + url.search + url.hash);
    document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", next === "dark" ? "true" : "false");
    });
  }

  document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
    btn.setAttribute("aria-pressed", theme() === "dark" ? "true" : "false");
    btn.addEventListener("click", function () {
      setTheme(theme() === "dark" ? "light" : "dark");
    });
  });

  document.addEventListener("click", function (e) {
    var a = e.target.closest("a[href]");
    if (!a) return;
    var href = a.getAttribute("href");
    if (!href || /^(https?:|mailto:|#)/.test(href)) return;
    var url = new URL(href, location.href);
    if (url.origin !== location.origin) return;
    url.searchParams.set("theme", theme());
    a.href = url.pathname + url.search + url.hash;
  });

  function pinSVG(letter, shape, color, ink, size) {
    var s = size;
    var sw = Math.max(1.15, s * 0.075);
    var shapeEl;
    var ty = s / 2;
    var fs = s * 0.4;
    if (shape === "head") {
      shapeEl = '<polygon points="' + (s / 2) + ',2 ' + (s - 2) + ',' + (s - 2.5) + ' 2,' + (s - 2.5) + '" fill="' + color + '" stroke="#fff" stroke-width="' + sw + '" stroke-linejoin="round"/>';
      ty = s * 0.66;
      fs = s * 0.32;
    } else if (shape === "drop") {
      shapeEl = '<rect x="2.6" y="2.6" width="' + (s - 5.2) + '" height="' + (s - 5.2) + '" rx="2" fill="' + color + '" stroke="#fff" stroke-width="' + sw + '"/>';
    } else {
      shapeEl = '<circle cx="' + (s / 2) + '" cy="' + (s / 2) + '" r="' + (s / 2 - 2.6) + '" fill="' + color + '" stroke="#fff" stroke-width="' + sw + '"/>';
    }
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 ' + s + ' ' + s + '" aria-hidden="true">' + shapeEl +
      '<text x="' + (s / 2) + '" y="' + ty + '" fill="' + ink + '" font-size="' + fs.toFixed(1) + '" font-weight="700" text-anchor="middle" dominant-baseline="central" font-family="Inter,system-ui,sans-serif">' + letter + '</text></svg>';
  }

  document.querySelectorAll("[data-banner]").forEach(function (btn) {
    var banner = btn.closest(".banner");
    var panel = document.getElementById(btn.getAttribute("aria-controls"));
    function setOpen(open) {
      banner.classList.toggle("is-open", open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      if (panel) panel.setAttribute("aria-hidden", open ? "false" : "true");
    }
    setOpen(false);
    btn.addEventListener("click", function () { setOpen(!banner.classList.contains("is-open")); });
  });

  document.querySelectorAll("[data-osm]").forEach(function (box) {
    box.addEventListener("change", function () {
      var stage = box.closest(".map-stage") || document.querySelector(".map-stage");
      if (stage) stage.classList.toggle("show-osm", box.checked);
    });
  });

  document.querySelectorAll(".map-rot").forEach(function (rot) {
    var z = parseFloat(getComputedStyle(rot).getPropertyValue("--z")) || parseFloat(rot.style.getPropertyValue("--z")) || 1;
    if (!rot.style.getPropertyValue("--z")) rot.style.setProperty("--z", String(z));
    var ctrl = rot.parentElement.querySelector(".zoom-ctrl");
    if (!ctrl) return;
    ctrl.addEventListener("click", function (e) {
      var b = e.target.closest("[data-zoom]");
      if (!b) return;
      var cur = parseFloat(rot.style.getPropertyValue("--z")) || 1;
      var next = b.getAttribute("data-zoom") === "in" ? Math.min(2.2, cur + 0.25) : Math.max(1, cur - 0.25);
      rot.style.setProperty("--z", String(Math.round(next * 100) / 100));
    });
  });

  function catalog() {
    var node = document.getElementById("catalog");
    if (!node) return [];
    try { return JSON.parse(node.textContent); } catch (e) { return []; }
  }

  function byId(id) {
    return catalog().filter(function (h) { return h.id === id; })[0] || null;
  }

  function detailHTML(h) {
    var pending = h.pending
      ? "<p>" + h.pending + "</p>"
      : "<p class=\"quiet\">None. A change applies when 3 people propose it.</p>";
    var votes = !h.votes || !h.votes.length
      ? "<p class=\"quiet\">No votes yet.</p>"
      : "<table class=\"vote-table\"><thead><tr><th>When</th><th>Vote</th><th>From</th><th>Weight</th></tr></thead><tbody>" +
        h.votes.map(function (v) {
          return "<tr><td>" + v.when + "</td><td>" + v.vote + "</td><td>" + v.from + "</td><td>" + v.weight + "</td></tr>";
        }).join("") + "</tbody></table>";
    return (
      '<div class="hazard-head"><span class="pin-tile">' + pinSVG(h.letter, h.shape, h.color, h.ink, 24) + "</span>" +
      "<div><h3>" + h.label + (h.sample ? ' <span class="sample">Sample</span>' : "") + "</h3>" +
      '<p class="hazard-meta">' + h.category + " · " + h.band + " · type “" + h.type + "”</p></div></div>" +
      (h.sample ? '<div class="notice"><div><strong>Sample hazard</strong><p>Seeded for the demo, not a real report. Votes still count for the demo.</p></div></div>' : "") +
      '<div class="photo-empty"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 3l18 18M9.5 5h5l1.5 2H19a2 2 0 0 1 2 2v8.5M17.5 19H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.5"/></svg>No photo was sent with this report</div>' +
      '<dl class="kv"><div><dt>Clearance height</dt><dd>' + h.clearance + "</dd></div>" +
      "<div><dt>Remaining sidewalk width</dt><dd>" + h.width + "</dd></div>" +
      "<div><dt>Confidence</dt><dd>" + h.confidence.toFixed(1) + " <span>(cleared below −2)</span></dd></div>" +
      "<div><dt>Severity</dt><dd>" + h.severity + "</dd></div>" +
      "<div><dt>Last seen</dt><dd>" + h.seen + "</dd></div>" +
      "<div><dt>Expires</dt><dd>" + h.expires + " <span>(" + h.expiresNote + ")</span></dd></div>" +
      "<div><dt>First reported</dt><dd>" + h.reported + "</dd></div>" +
      '<div><dt>Spoken in Spanish</dt><dd lang="es">' + h.es + "</dd></div></dl>" +
      '<section><h3 class="block-title">Pending reclassifications</h3>' + pending + "</section>" +
      '<section><h3 class="block-title">Vote history (' + ((h.votes && h.votes.length) || 0) + ")</h3>" + votes + "</section>"
    );
  }

  var dockList = document.getElementById("dock-list");
  var dockDetail = document.getElementById("dock-detail");
  var dockBody = document.getElementById("dock-detail-body");
  var dockFull = document.getElementById("dock-full");
  var selectedId = null;

  function selectHazard(id) {
    var h = byId(id);
    if (!h || !dockDetail || !dockBody) return;
    selectedId = id;
    dockBody.innerHTML = detailHTML(h);
    if (dockFull) {
      var href = "hazard.html#" + encodeURIComponent(id);
      dockFull.setAttribute("href", href);
    }
    dockList.hidden = true;
    dockDetail.hidden = false;
    document.querySelectorAll("[data-select]").forEach(function (el) {
      var on = el.getAttribute("data-select") === id;
      el.classList.toggle("is-selected", on && el.classList.contains("feed-row"));
      el.classList.toggle("is-on", on && el.classList.contains("mappin"));
    });
    var heading = dockBody.querySelector("h3");
    if (heading) { heading.tabIndex = -1; heading.focus(); }
  }

  document.querySelectorAll("[data-select]").forEach(function (el) {
    el.addEventListener("click", function () { selectHazard(el.getAttribute("data-select")); });
  });

  var back = document.querySelector("[data-dock-back]");
  if (back) {
    back.addEventListener("click", function () {
      if (!dockList || !dockDetail) return;
      dockDetail.hidden = true;
      dockList.hidden = false;
      document.querySelectorAll(".mappin").forEach(function (p) { p.classList.remove("is-on"); });
      var row = selectedId && document.querySelector('.feed-row[data-select="' + selectedId + '"]');
      if (row) row.focus();
    });
  }

  var sheet = document.getElementById("hazard-sheet");
  if (sheet && location.hash.length > 1) {
    var wanted = decodeURIComponent(location.hash.slice(1));
    var item = byId(wanted);
    if (item && wanted !== "pothole") {
      sheet.innerHTML = detailHTML(item).replace("<h3>", "<h2>").replace("</h3>", "</h2>");
      var pin = document.getElementById("hazard-pin");
      if (pin) {
        pin.style.left = item.x + "%";
        pin.style.top = item.y + "%";
        pin.innerHTML = pinSVG(item.letter, item.shape, item.color, item.ink, item.size);
        pin.setAttribute("aria-label", item.label);
      }
      var title = document.getElementById("hazard-banner-title");
      var sub = document.getElementById("hazard-banner-sub");
      var where = document.getElementById("hazard-where");
      if (title) title.textContent = item.spoken;
      if (sub) sub.textContent = item.label + " · " + item.category.toLowerCase();
      if (where) where.textContent = item.label + " at " + item.lat + ", " + item.lng + ". Last seen " + item.seen + ". Confidence " + item.confidence.toFixed(1) + ".";
      var rot = document.querySelector(".loc-card .map-rot");
      if (rot) {
        rot.style.setProperty("--ox", item.x + "%");
        rot.style.setProperty("--oy", item.y + "%");
      }
      document.title = item.label + " · Hazard details · Path Guard";
    }
  }

  var verifyCard = document.getElementById("verify-card");
  var queueNode = verifyCard ? document.getElementById("catalog") : null;
  if (queueNode && verifyCard) {
    var queueAll = [];
    try { queueAll = JSON.parse(queueNode.textContent); } catch (e) {}
    queueAll.sort(function (a, b) { return a.confidence - b.confidence; });
    var skipped = {};
    var voted = {};
    var shortcutsOn = true;
    var current = null;

    function remaining() {
      return queueAll.filter(function (h) { return !voted[h.id] && !skipped[h.id]; });
    }

    function paintProgress() {
      var left = remaining().length;
      var checked = queueAll.filter(function (h) { return voted[h.id]; }).length;
      var leftEl = document.getElementById("left-count");
      var checkedEl = document.getElementById("checked-line");
      var bar = document.getElementById("checked-bar");
      var prog = document.getElementById("review-progress");
      if (leftEl) leftEl.textContent = String(left);
      if (checkedEl) checkedEl.textContent = checked + " of " + queueAll.length + " checked from this device";
      if (bar) bar.style.width = (queueAll.length ? (checked / queueAll.length) * 100 : 0) + "%";
      if (prog) {
        prog.setAttribute("aria-valuenow", String(checked));
        prog.setAttribute("aria-valuemax", String(queueAll.length));
      }
    }

    function setVotesVisible(on) {
      document.querySelectorAll(".vote-dock").forEach(function (el) {
        if (verifyCard && verifyCard.contains(el)) return;
        el.hidden = !on;
      });
    }

    function showCaught(skippedLeft) {
      verifyCard.hidden = true;
      setVotesVisible(false);
      var box = document.getElementById("caught-up");
      if (!box) return;
      box.hidden = false;
      var title = document.getElementById("caught-title");
      var copy = document.getElementById("caught-copy");
      var review = document.getElementById("review-skipped");
      if (skippedLeft) {
        if (title) title.textContent = "You skipped the remaining " + skippedLeft + ".";
        if (copy) copy.textContent = "They stay in the queue until you vote.";
        if (review) review.hidden = false;
      } else {
        if (title) title.textContent = "You’re all caught up.";
        if (copy) copy.textContent = "This device has voted on every active hazard in the mockup. New reports would appear here live.";
        if (review) review.hidden = true;
      }
    }

    function showCard(h) {
      current = h;
      var box = document.getElementById("caught-up");
      if (box) box.hidden = true;
      verifyCard.hidden = false;
      setVotesVisible(true);
      var label = document.getElementById("v-label");
      var badge = document.getElementById("v-sample");
      var meta = document.getElementById("v-meta");
      var notice = document.getElementById("v-notice");
      var conf = document.getElementById("v-conf");
      var clearance = document.getElementById("v-clearance");
      var width = document.getElementById("v-width");
      var link = document.getElementById("v-full");
      var tile = document.getElementById("v-tile");
      var pin = document.getElementById("v-pin");
      var rot = document.querySelector(".verify-map .map-rot");
      if (label) label.textContent = h.label;
      if (badge) badge.hidden = !h.sample;
      if (meta) meta.textContent = h.category + " · " + h.band + " · type “" + h.type + "”";
      if (notice) notice.hidden = !h.sample;
      if (conf) conf.textContent = h.confidence.toFixed(1);
      if (clearance) clearance.textContent = h.clearance;
      if (width) width.textContent = h.width;
      if (link) link.setAttribute("href", "hazard.html#" + encodeURIComponent(h.id));
      if (tile) tile.innerHTML = pinSVG(h.letter, h.shape, h.color, h.ink, 24);
      if (pin) {
        pin.style.left = h.x + "%";
        pin.style.top = h.y + "%";
        pin.innerHTML = pinSVG(h.letter, h.shape, h.color, h.ink, h.size);
        pin.setAttribute("aria-label", h.label + ", " + h.category + ", " + h.band + ", confidence " + h.confidence.toFixed(1));
      }
      if (rot) {
        rot.style.setProperty("--ox", h.x + "%");
        rot.style.setProperty("--oy", h.y + "%");
      }
      var tag = document.getElementById("v-tag");
      if (tag) tag.hidden = !h.sample;
      if (tag) { tag.style.left = h.x + "%"; tag.style.top = h.y + "%"; }
    }

    function advance(message) {
      var live = document.getElementById("verify-live");
      if (live) live.textContent = message;
      paintProgress();
      var next = remaining()[0];
      if (next) showCard(next);
      else showCaught(queueAll.filter(function (h) { return skipped[h.id] && !voted[h.id]; }).length);
    }

    function vote(dir) {
      if (!current || voted[current.id]) return;
      voted[current.id] = true;
      var nextConf = dir === "up" ? Math.min(5, current.confidence + 1) : current.confidence - 1;
      var text = dir === "up"
        ? "Upvoted: still there. Confidence is now " + nextConf.toFixed(1) + "."
        : "Downvoted: gone or not a hazard. Confidence is now " + nextConf.toFixed(1) + (nextConf < -2 ? " and the hazard is cleared." : ".");
      advance(text);
    }

    function skip() {
      if (!current) return;
      var name = current.label;
      skipped[current.id] = true;
      var next = remaining()[0];
      advance(next ? "Skipped " + name + ". Next: " + next.label + "." : "Skipped " + name + ". Nothing left in this pass.");
    }

    document.querySelectorAll("[data-vote]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var dir = btn.getAttribute("data-vote");
        if (dir === "skip") skip();
        else vote(dir);
      });
    });

    var shortcutBox = document.querySelector("[data-shortcuts]");
    if (shortcutBox) {
      shortcutsOn = shortcutBox.checked;
      document.body.classList.toggle("keys-off", !shortcutsOn);
      shortcutBox.addEventListener("change", function () {
        shortcutsOn = shortcutBox.checked;
        document.body.classList.toggle("keys-off", !shortcutsOn);
      });
    }

    document.addEventListener("keydown", function (e) {
      if (!shortcutsOn || !verifyCard || verifyCard.hidden) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      var el = e.target;
      if (el && el.closest && el.closest("a, button, input, textarea, select, summary, label")) return;
      var key = e.key.toLowerCase();
      if (key === "u") vote("up");
      else if (key === "d") vote("down");
      else if (key === "s") skip();
      else return;
      e.preventDefault();
    });

    var reviewBtn = document.getElementById("review-skipped");
    if (reviewBtn) {
      reviewBtn.addEventListener("click", function () {
        skipped = {};
        paintProgress();
        var next = remaining()[0];
        if (next) showCard(next);
      });
    }

    document.querySelectorAll("[data-panel]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("aria-controls");
        var panel = document.getElementById(id);
        var open = panel.hasAttribute("hidden");
        document.querySelectorAll(".form-panel").forEach(function (p) { p.setAttribute("hidden", ""); });
        document.querySelectorAll("[data-panel]").forEach(function (b) { b.setAttribute("aria-expanded", "false"); });
        if (open) {
          panel.removeAttribute("hidden");
          btn.setAttribute("aria-expanded", "true");
        }
      });
    });

    var reclassify = document.getElementById("reclassify-form");
    if (reclassify) {
      reclassify.addEventListener("submit", function (e) {
        e.preventDefault();
        var out = document.getElementById("reclassify-result");
        if (out) {
          out.hidden = false;
          out.textContent = "Proposal recorded: 1 of 3 agree so far. It applies when 3 people propose the same change.";
        }
      });
    }
    var report = document.getElementById("report-form");
    if (report) {
      report.addEventListener("submit", function (e) {
        e.preventDefault();
        var out = document.getElementById("report-result");
        if (out) {
          out.hidden = false;
          out.textContent = "Report sent. Thank you; moderators will review it.";
        }
      });
    }

    current = remaining()[0] || null;
    paintProgress();
  }
})();
