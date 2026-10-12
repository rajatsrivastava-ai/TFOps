"use strict";
/* The server's handle on the schedule engine. The engine is an ES module the
   browser imports directly (public/js/schedule.mjs); here it is loaded once
   with a dynamic import so both sides compute forecasts from the same code. */

const path = require("path");
const { pathToFileURL } = require("url");

let loading = null;
function engine() {
  if (!loading) {
    loading = import(pathToFileURL(path.join(__dirname, "..", "public", "js", "schedule.mjs")).href)
      .catch((err) => { loading = null; throw err; });
  }
  return loading;
}

module.exports = { engine };
