(function () {
  "use strict";
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("./sw.js").catch(function () {
      /* The site still works as a normal page if installation is blocked. */
    });
  });
})();
