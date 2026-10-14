/* Cloudflare Web Analytics: free, no cookies, counts visits to each page.
   It stays off until you paste your site token below.

   To get the token: Cloudflare dashboard > Analytics & Logs > Web Analytics > Add a site >
   enter davidsolar.dev > Done. Cloudflare then shows a JS snippet. Copy only the value after
   "token": (a long string of letters and numbers) and paste it between the quotes below.

   Every page on the site loads this one file, so this is the only place the token goes. */
(function () {
  var TOKEN = "";

  // Only count visits to the live site, not previews or local copies
  if (!TOKEN || location.hostname !== "davidsolar.dev") return;

  var s = document.createElement("script");
  s.defer = true;
  s.src = "https://static.cloudflareinsights.com/beacon.min.js";
  s.setAttribute("data-cf-beacon", JSON.stringify({ token: TOKEN }));
  document.head.appendChild(s);
})();
