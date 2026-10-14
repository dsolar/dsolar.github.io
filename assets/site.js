/* Small things every page on the site shares. */
(function () {
  // Email links are written as data-user + data-domain so simple spam bots can't read
  // the address from the page source. This turns them into real mailto: links.
  // Add data-show to also replace the link text with the address itself.
  document.querySelectorAll("[data-user][data-domain]").forEach(function (a) {
    var address = a.getAttribute("data-user") + "@" + a.getAttribute("data-domain");
    a.href = "mailto:" + address;
    if (a.hasAttribute("data-show")) a.textContent = address;
  });

  // Counts the articles in the Writing section, so the number next to the heading never goes stale
  var count = document.getElementById("writing-count");
  if (count) {
    var n = document.querySelectorAll("#writing .article-list li").length;
    if (n) count.textContent = n + (n === 1 ? " article" : " articles");
  }

  // Keeps the footer's copyright year current
  var year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();
})();
