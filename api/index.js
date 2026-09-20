"use strict";
/* What Vercel invokes. server.js exports the same request handler it gives its
   own http server, so there is one code path and no serverless-only copy of
   the routing to keep in step.

   vercel.json sends every non-static path here; the original URL survives the
   rewrite, which is what lets the handler keep routing on req.url. */

module.exports = require("../server.js");
