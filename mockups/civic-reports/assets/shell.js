/* Static mockup behavior: theme, map layer, zoom, verify actions. No API. */
(function () {
  var root = document.documentElement;

  function theme() {
    return root.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function applyTheme(next, writeUrl) {
    root.setAttribute("data-theme", next);
    document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", next === "dark" ? "true" : "false");
    });
    document.querySelectorAll("a[href]").forEach(function (a) {
      var raw = a.getAttribute("href");
      if (!raw || raw.charAt(0) === "#" || /^(https?:|mailto:)/i.test(raw)) return;
      var hash = "";
      var path = raw;
      var hashAt = raw.indexOf("#");
      if (hashAt >= 0) {
        hash = raw.slice(hashAt);
        path = raw.slice(0, hashAt);
      }
      path = path.split("?")[0];
      a.setAttribute("href", path + "?theme=" + next + hash);
    });
    if (writeUrl) {
      var url = new URL(location.href);
      url.searchParams.set("theme", next);
      history.replaceState(null, "", url);
    }
  }

  applyTheme(theme(), false);

  document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      applyTheme(theme() === "dark" ? "light" : "dark", true);
    });
  });

  document.querySelectorAll("[data-osm]").forEach(function (input) {
    var panel = document.getElementById(input.getAttribute("data-osm"));
    if (!panel) return;
    var sync = function () {
      panel.classList.toggle("show-osm", input.checked);
    };
    input.addEventListener("change", sync);
    sync();
  });

  document.querySelectorAll("[data-zoom]").forEach(function (wrap) {
    var stage = wrap.querySelector("[data-stage]");
    var z = 1;
    var paint = function () {
      if (stage) stage.style.transform = "scale(" + z + ")";
    };
    var zoomIn = wrap.querySelector("[data-zoom-in]");
    var zoomOut = wrap.querySelector("[data-zoom-out]");
    if (zoomIn) {
      zoomIn.addEventListener("click", function () {
        z = Math.min(1.8, Math.round((z + 0.2) * 10) / 10);
        paint();
      });
    }
    if (zoomOut) {
      zoomOut.addEventListener("click", function () {
        z = Math.max(1, Math.round((z - 0.2) * 10) / 10);
        paint();
      });
    }
  });

  var shortcuts = document.querySelector("[data-shortcuts]");
  if (shortcuts) {
    var syncShortcuts = function () {
      document.body.classList.toggle("shortcuts-off", !shortcuts.checked);
    };
    shortcuts.addEventListener("change", syncShortcuts);
    syncShortcuts();
  }

  function say(title, body) {
    var box = document.querySelector("[data-vote-result]");
    if (!box) return;
    var t = box.querySelector("[data-vote-title]");
    var b = box.querySelector("[data-vote-body]");
    if (t) t.textContent = title;
    if (b) b.textContent = body;
    box.hidden = false;
  }

  document.querySelectorAll("[data-vote]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var dir = btn.getAttribute("data-vote");
      if (dir === "up") {
        say("Upvoted: still there.", "Confidence is now 1.4. This static mockup does not send the vote.");
      } else if (dir === "down") {
        say("Downvoted: gone or not a hazard.", "Confidence is now −0.6. This static mockup does not send the vote.");
      } else {
        say("Skipped drop-off.", "Next in a live queue would be drop-off: pothole. Nothing is removed from this mockup.");
      }
    });
  });

  document.querySelectorAll("[data-panel-open]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var panel = document.getElementById(btn.getAttribute("aria-controls"));
      if (!panel) return;
      var willOpen = panel.hidden;
      document.querySelectorAll(".subform").forEach(function (node) {
        node.hidden = true;
      });
      document.querySelectorAll("[data-panel-open]").forEach(function (other) {
        other.setAttribute("aria-expanded", "false");
      });
      panel.hidden = !willOpen;
      btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
      if (willOpen) {
        var field = panel.querySelector("select, textarea, button");
        if (field) field.focus();
      }
    });
  });

  document.querySelectorAll("form[data-static]").forEach(function (form) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var note = form.querySelector("[data-form-result]");
      if (note) note.hidden = false;
    });
  });

  window.addEventListener("keydown", function (event) {
    if (document.body.classList.contains("shortcuts-off")) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
    var el = event.target;
    if (el && el.closest && el.closest("a, button, input, textarea, select, summary, label")) return;
    var key = event.key.toLowerCase();
    var dir = key === "u" ? "up" : key === "d" ? "down" : key === "s" ? "skip" : "";
    if (!dir) return;
    var btn = document.querySelector('[data-vote="' + dir + '"]');
    if (!btn) return;
    event.preventDefault();
    btn.click();
  });
})();
