/* One navigation for the whole site. Project links come from assets/projects.js. */
(function () {
  "use strict";
  var script = document.currentScript;
  var root = new URL("../", script.src).pathname;
  var bar = document.querySelector("[data-ds-navigation]");
  if (!bar) return;
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var at = function (path) { return root + path; };
  var path = location.pathname.slice(root.length).replace(/index\.html$/, "").replace(/\/$/, "");
  var folder = path.split("/")[0];
  var all = window.PROJECTS || [];
  var project = all.find(function (p) { return !p.external && p.url.replace(/\/$/, "") === folder; });
  var section = folder === "fantasy" || folder === "fantasy-kit" || folder === "hardcap" ? "fantasy"
    : folder === "games" ? "games" : folder === "simulations" ? "simulations"
    : folder === "kids" || (project && project.section === "kids") ? "kids"
    : project && project.type === "Fantasy Leagues" ? "fantasy"
    : project && project.type === "Games" ? "games"
    : project && project.type === "Simulations" ? "simulations" : "";
  var sections = [
    { id: "fantasy", label: "Fantasy", url: "fantasy/" },
    { id: "games", label: "Games", url: "games/" },
    { id: "simulations", label: "Simulations & Tools", url: "simulations/" },
    { id: "kids", label: "Kids", url: "kids/" },
    { id: "writing", label: "Writing", url: "#writing" }
  ];
  var parent = sections.find(function (s) { return s.id === section; });
  var isHub = !path || folder === "kids" || folder === "fantasy" || folder === "games" || folder === "simulations" || path === "404.html";
  var desktop = matchMedia("(min-width: 1000px)");
  var chevron = '<svg viewBox="0 0 12 8" width="10" height="7" aria-hidden="true"><path d="m1 1 5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>';
  document.body.classList.add("ds-page-" + (folder.replace(/[^a-z0-9-]/gi, "") || "home"));
  bar.classList.add("ds-navigation");
  bar.dataset.layout = isHub ? "hub" : "app";
  bar.dataset.enhanced = "true";

  function unlocked() {
    try { return sessionStorage.getItem("dsolar-hidden-apps") === "shown"; } catch (e) { return false; }
  }
  function link(p) {
    var current = at(p.url) === location.pathname || at(p.url) === location.pathname.replace(/index\.html$/, "");
    return '<a class="ds-menu-link" href="' + esc(at(p.url)) + '"' + (current ? ' aria-current="page"' : "") + '><span>' + esc(p.title) + '</span>' + (p.line ? '<small>' + esc(p.line) + '</small>' : '') + '</a>';
  }
  function group(title, projects) {
    if (!projects.length) return "";
    return '<div class="ds-menu-group"><p class="ds-menu-label">' + esc(title) + '</p>' + projects.map(link).join("") + '</div>';
  }
  function menu(id, visible) {
    if (id === "fantasy") {
      return group("Draft & manage", [
        { title: "Fantasy overview", url: "fantasy/" },
        { title: "Your leagues", url: "fantasy-kit/leagues.html" },
        { title: "Draft Lab", line: "Mock drafts & player rankings", url: "fantasy-kit/" }
      ]) + group("League pages", visible.filter(function (p) { return p.type === "Fantasy Leagues" && p.url !== "fantasy/"; }));
    }
    if (id === "games") {
      var games = visible.filter(function (p) { return p.type === "Games" && !p.section; });
      return group("Daily challenges", games.filter(function (p) { return p.daily; }))
        + group("Strategy & more", games.filter(function (p) { return !p.daily; }));
    }
    if (id === "simulations") return group("The front office & draft board", visible.filter(function (p) { return p.type === "Simulations"; }));
    return "";
  }
  function closeDropdowns(except) {
    bar.querySelectorAll(".ds-disclosure").forEach(function (button) {
      if (button === except) return;
      button.setAttribute("aria-expanded", "false");
      document.getElementById(button.getAttribute("aria-controls")).hidden = true;
    });
  }
  function closeNavigation() {
    closeDropdowns();
    var toggle = bar.querySelector(".ds-menu-toggle");
    if (!desktop.matches) bar.querySelector(".ds-primary").hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  }
  function render() {
    var visible = all.filter(function (p) { return !p.members && (!p.hidden || unlocked()) && (p.status !== "building" || (p.hidden && unlocked())); });
    bar.innerHTML = '<div class="ds-nav-inner"><a class="ds-brand" href="' + esc(root) + '" aria-label="David Solar, home"' + (!path ? ' aria-current="page"' : '') + '><img src="' + esc(at("assets/nav-mark.svg")) + '" alt="" width="42" height="42"><span>David Solar</span></a>'
      + (!isHub && parent ? '<a class="ds-parent" href="' + esc(at(parent.url)) + '"><span aria-hidden="true">←</span> ' + esc(parent.label) + '</a>' : '')
      + '<button class="ds-menu-toggle" type="button" aria-expanded="false" aria-controls="ds-primary"><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M2 5h16M2 10h16M2 15h16" stroke="currentColor" stroke-width="1.6"/></svg><span>Menu</span></button>'
      + '<div class="ds-primary" id="ds-primary"' + (!desktop.matches ? ' hidden' : '') + '>' + sections.map(function (s) {
        var contents = menu(s.id, visible);
        var active = section === s.id;
        return '<div class="ds-nav-item' + (active ? ' ds-current' : '') + '"><div class="ds-nav-label"><a class="ds-section-link" href="' + esc(at(s.url)) + '"' + (active ? ' aria-current="' + (folder === s.id ? 'page' : 'location') + '"' : '') + '>' + esc(s.label) + '</a>'
          + (contents ? '<button class="ds-disclosure" type="button" id="ds-toggle-' + s.id + '" aria-label="' + esc(s.label) + ' submenu" aria-expanded="false" aria-controls="ds-menu-' + s.id + '">' + chevron + '</button>' : '') + '</div>'
          + (contents ? '<div class="ds-dropdown ds-dropdown-' + s.id + '" id="ds-menu-' + s.id + '" aria-labelledby="ds-toggle-' + s.id + '" hidden>' + contents + '<a class="ds-view-all" href="' + esc(at(s.url)) + '">Explore ' + esc(s.label) + ' <span aria-hidden="true">→</span></a></div>' : '') + '</div>';
      }).join("") + '<a class="ds-all-projects" href="' + esc(at("#projects")) + '">Explore all projects <span aria-hidden="true">→</span></a></div>'
      // Sign in, or your account (assets/account.js fills it)
      + '<div class="ds-account" id="ds-account"></div></div>';
    // The same category destinations in every full-size footer.
    document.querySelectorAll(".foot-nav").forEach(function (footer) {
      var email = footer.querySelector("[data-user]");
      footer.innerHTML = sections.map(function (s) { return '<a href="' + esc(at(s.url)) + '">' + esc(s.label) + '</a>'; }).join("") + '<a href="' + esc(at("#about")) + '">About</a>';
      if (email) footer.appendChild(email);
    });
  }
  render();
  window.dispatchEvent(new Event("dsolar:nav-render"));
  // the site's account: sign in from any page, and the daily games' saves follow you (assets/account.js)
  if (!window.DSAccount && !document.querySelector('script[src*="assets/account.js"]')) {
    var acct = document.createElement("script"); acct.src = at("assets/account.js?v=20261105-acct"); acct.defer = true; document.head.appendChild(acct);
  }
  bar.addEventListener("click", function (event) {
    var button = event.target.closest("button");
    if (button && button.classList.contains("ds-menu-toggle")) {
      var open = button.getAttribute("aria-expanded") !== "true";
      closeDropdowns();
      button.setAttribute("aria-expanded", String(open));
      bar.querySelector(".ds-primary").hidden = !open;
    } else if (button && button.classList.contains("ds-disclosure")) {
      var expanded = button.getAttribute("aria-expanded") !== "true";
      closeDropdowns(button);
      button.setAttribute("aria-expanded", String(expanded));
      document.getElementById(button.getAttribute("aria-controls")).hidden = !expanded;
    } else if (event.target.closest("a")) closeNavigation();
  });
  document.addEventListener("click", function (event) { if (!bar.contains(event.target)) closeNavigation(); });
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape" || !bar.contains(document.activeElement)) return;
    var open = bar.querySelector('.ds-disclosure[aria-expanded="true"]');
    if (open) { closeDropdowns(); open.focus(); event.preventDefault(); event.stopPropagation(); }
    else if (!desktop.matches && bar.querySelector(".ds-menu-toggle").getAttribute("aria-expanded") === "true") {
      closeNavigation(); bar.querySelector(".ds-menu-toggle").focus(); event.preventDefault(); event.stopPropagation();
    }
  });
  bar.addEventListener("focusout", function (event) {
    if (!event.relatedTarget || !bar.contains(event.relatedTarget)) closeNavigation();
    else if (desktop.matches) {
      var item = event.target.closest(".ds-nav-item");
      if (item && !item.contains(event.relatedTarget)) closeDropdowns();
    }
  });
  desktop.addEventListener("change", function () { closeDropdowns(); bar.querySelector(".ds-primary").hidden = !desktop.matches; bar.querySelector(".ds-menu-toggle").setAttribute("aria-expanded", "false"); });
  window.addEventListener("dsolar:projects-change", function () { render(); window.dispatchEvent(new Event("dsolar:nav-render")); });
  if (window.ResizeObserver) new ResizeObserver(function () {
    document.documentElement.style.setProperty("--ds-navigation-height", bar.getBoundingClientRect().height + "px");
  }).observe(bar);
})();
