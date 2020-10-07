const fastify = require('fastify');

// The Sync logic
const runsync = require('./index');


// Default port is 3999
const port = process.env.PORT || 3999;

// Default webhook endpoint is simply the root (/)
const endpoint = process.env.PORT || '/';

// Weebhook authentication token
const webhooktoken = process.env.WEBHOOK_TOKEN;


function init() {
  const app = fastify();

  app.post(endpoint, async (request, reply) => {
    // Check webhook key
    if (webhooktoken && request.headers.authorization !== 'Bearer '+webhooktoken) {
      console.log('Invalid auth token.');
      return reply.send(403);
    }

    // TODO: process request.body and pass in some useful metadata to the
    // sync logic (e.g. update type and CMS user who invoked the change)

    // TODO: rate limiting and build queueing ("debounce")
    await runsync();

    reply.send(200);
  });
  return app;
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
