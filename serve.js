const fastify = require('fastify');

// The Sync logic
const runSync_call = require('./index');
function runSync() {
  return runSync_call();
}


// Default port is 3999
const port = process.env.PORT || 3999;

// Default webhook endpoint is simply the root (/)
const endpoint = process.env.WEBHOOK_ENDPOINT || '/';

// Weebhook authentication token
const webhooktoken = process.env.WEBHOOK_TOKEN;

// Ignored models (no updates triggered)
const ignored = process.env.WEBHOOK_IGNORED_MODELS || '';


function init() {
  const app = fastify();

  app.post(endpoint, async (request, reply) => {
    // Check webhook key
    if (webhooktoken && request.headers.authorization !== 'Bearer '+webhooktoken) {
      console.log('Invalid auth token.');
      return reply.send(403);
    }

    // Send confirmation early (to avoid connection timeouts)
    // Webhooks don't care about the success of the *build* we kicked off anyway,
    // we need to track that separately.
    // TODO: track build status
    reply.send(200);

    // Do not run for webhooks that are triggered by ignored models
    if (ignored.includes(request.body.model)) {
      console.log(`Ignored: ${request.body.event} in ${request.body.model}`);
      return;
    }

    // TODO: process request.body and pass in some useful metadata to the
    // sync logic (e.g. update type and CMS user who invoked the change)

    // Rate limiting the sync process
    // Note: this is an async function but the request handler doesn't care about
    // when it finishes (already returned early) so no await needed
    return ratelimit(runSync);
  });

  return app;
}

// Rate limit function calls

// Default value of the countdown timer in ms. Each call to ratelimit for the
// same fn resets the countdown to this value. After the countdown expires, fn
// is launched.
// Defaults to 60 seconds
const RATELIMIT_DELAY = process.env.RATELIMIT_DELAY || 60*1000;

// Allow ratelimit to run processes concurrently? If disabled timer execution is
// automatically suspended while a call to fn is running. Timers resume after
// fn is finished.
// Defaults to false
const RATELIMIT_CONCURRENT = !!process.env.RATELIMIT_CONCURRENT;

const ratelimitFns = new Map();

function ratelimit(fn, execute = false) {
  const now = Date.now();

  // Get ratelimit descriptor for this function
  let rldesc = ratelimitFns.get(fn);

  // First-time call to rate limited function
  if (!rldesc || rldesc.firstset === 0) {
    rldesc = Object.assign(rldesc || {}, {
      fn,
      running: false,
      firstset: now,
      lastset: now,
      expiry:  now + RATELIMIT_DELAY,
      timeout: setTimeout(
        // Set the execute bit on the callback
        ratelimit.bind(null, fn, true),
        RATELIMIT_DELAY
      )
    });

    // Promise to track progress of the ratelimited function's execution
    rldesc.progress = new Promise((resolve, reject) => {
      rldesc.progressDone = (r) => {
        rldesc.lastsuccess = true;
        rldesc.lastresult = r;
        resolve(r);
      };

      rldesc.progressFailed = (e) => {
        rldesc.lastsuccess = false;
        rldesc.lastresult = e;
        reject(e)
      };
    });

    // Store the new descriptor
    ratelimitFns.set(fn, rldesc);

    console.log(`Rate limited: ${fn.name} for ${(RATELIMIT_DELAY/1000).toFixed(0)}s`);
    return rldesc.progress;
  }

  // If already running, wait for the process to finish
  // TODO: concurrent enabled?
  if (rldesc.running) {
    console.log(`Delayed: concurrent runs are not allowed for ${fn.name}`);

    // This reschedules the fn call with the default RATELIMIT_DELAY
    // TODO: maybe take into account the current rldesc.expiry?
    return rldesc.progress.then(() => ratelimit(fn));
  }

  // If execute bit is set (=this is a ratelimit callback call) run the process
  // TODO: do we need to check for expiry?
  if (execute) {
    // Run the ratelimited function
    rldesc.running = fn();

    // After the process finished, inform the callsite
    rldesc.running
      .then(r => rldesc.progressDone(r))
      .catch(e => rldesc.progressFailed(e))
      // In either case reset some of the progress descriptor fields
      .finally(() => {
        // Report run status
        const status = rldesc.lastsuccess?'OK':'FAILED';
        const delay = now - rldesc.firstset;
        console.log(`${status} running ${fn.name} (delayed ${(delay/1000).toFixed(0)}s)`);
        if (!rldesc.lastsuccess) console.error(rldesc.lastresult);

        // Clear timeout, just to be sure (e.g. forced execute=true from outside
        // of a timeout callback)
        clearTimeout(rldesc.timeout);

        Object.assign(rldesc, {
          running: false,
          firstset: 0,
          lastset: 0,
          expiry: 0,
          timeout: null
        });
      });

    return rldesc.progress;
  }

  // New request for running the fn, so we reschedule with the default delay
  const delay = (now + RATELIMIT_DELAY) - rldesc.firstset;
  console.log(`Rate limited: ${fn.name} (total delay: ${(delay/1000).toFixed(0)}s)`);

  // Clear previous timeout
  clearTimeout(rldesc.timeout);

  // Reschedule for later with default delay
  Object.assign(rldesc, {
    lastset: now,
    expiry:  now + RATELIMIT_DELAY,
    timeout: setTimeout(
      // Set the execute bit on the callback
      ratelimit.bind(null, fn, true),
      RATELIMIT_DELAY
    )
  });

  return rldesc.progress;
}

// Direct execution via node
if (require.main === module) {
  init().listen(port, (err) => {
    if (err) return console.error(err);

    console.log(`Webhook server listening on ${port}`);
  });

} else {
  // please run as a server
}
