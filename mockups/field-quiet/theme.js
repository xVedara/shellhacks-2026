(function () {
  var root = document.documentElement;

  function sync(theme) {
    document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
    });
    document.querySelectorAll("[data-set-theme]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-set-theme") === theme ? "true" : "false");
    });
  }

  function apply(theme) {
    if (theme !== "light" && theme !== "dark") return;
    root.setAttribute("data-theme", theme);
    try { localStorage.setItem("field-quiet-theme", theme); } catch (e) {}
    sync(theme);
  }

  sync(root.getAttribute("data-theme") === "dark" ? "dark" : "light");

  document.addEventListener("click", function (e) {
    var toggle = e.target.closest("[data-theme-toggle]");
    if (toggle) {
      apply(root.getAttribute("data-theme") === "dark" ? "light" : "dark");
      return;
    }
    var set = e.target.closest("[data-set-theme]");
    if (set) apply(set.getAttribute("data-set-theme"));
  });

  window.addEventListener("message", function (e) {
    if (!e.data) return;
    if (e.data.theme === "light" || e.data.theme === "dark") apply(e.data.theme);
  });

  document.querySelectorAll("[data-osm]").forEach(function (input) {
    input.addEventListener("change", function () {
      document.querySelectorAll(".map-frame, .mini-map, .app-map").forEach(function (node) {
        node.classList.toggle("show-osm", input.checked);
      });
    });
  });

  document.querySelectorAll("[data-shortcuts]").forEach(function (input) {
    input.addEventListener("change", function () {
      document.querySelectorAll(".shortcut-copy").forEach(function (el) {
        el.hidden = !input.checked;
      });
    });
  });
})();
