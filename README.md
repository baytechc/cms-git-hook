CMS Git Hook
============

Tool for receiving webhooks from a CMS (e.g. content change hooks) and regenerating the sources of a static page in a Git repository. This tool is not concerned with generating the built (and deployed) website, but with synchronizing the CMS data into a Git repo, allowing for change tracking and reviews.

The first version is based on pulling information out of a Strapi REST endpoint and pushing Markdown/Nunjucks sources into an Eleventy site skeleton, but it should be rather straightforward to adopt to different tools and usecases. This version is focusing on interacting with a GitHub server, but uses `nodegit` and standard git integrations so might also just work with other Git hosts with few or no modifications.

*Very, very beta. May break, or eat your laundry. You have been warned.*


## Run modes

There are two ways to use the Git Sync logic, manually or as a webhook listener:

### Manual

Run the repo (`node .`) or the "build" npm script (`npm run build`) to execute the Git Sync logic from the commandline. `.env` files in the project root can be used to configure the script. The script exits after running one sync.

### Webhook

Run the "listen" npm script (`npm run listen`) to start a server (defaults to port `3999`, see configuration) that listens for incoming webhooks.

## Configuration

Configure using the following ENV variables.

* `GIT_REPO_SSH`:  
  Repository URL to pull/push to. Make sure you specify an SSH URL (the code will break on HTTP(S) Git URLs!). E.g.: `git@github.com:user/repo.git`. GitHub-specific links (e.g. PR URLs and such) are currently derived from this value.
* `GIT_LIVE_BRANCH`:  
  The branch that CMS content gets committed into. This is the branch we use for creating the initial local repository from, but the code writes new commits to individual snapshot branches.
* `GIT_PUBKEY_PATH` / `GIT_PRIVKEY_PATH`:  
  Path to the SSH private and public keys to use for authenticating with GitHub (`id_rsa`/`id_rsa.pub`)
* `GIT_PRIVKEY_PASSPHRASE`:  
  If the private key requires a passphrase to unlock, you can pass it in here.
* `REPO_BUILD_COMMAND`:  
  The command to execute on the repo to pull in the updated CMS content, e.g. `npm run get-cms-content` or similar.
* `GIT_AUTHOR` & `GIT_AUTHOR_CONTACT`:  
  Author name and contact (email address) to use in commits created by the Git Sync logic.
* `GIT_COMMITTER` & `GIT_COMMITTER_CONTACT`:  
  Committer name & contact information to use (defaults to author* values if omitted).

### Webhook service

Further configuration options available for the webhook service:

* `WEBHOOK_TOKEN`:  
  Limit access to the webhook service using [HTTP Bearer Token authentication](https://tools.ietf.org/html/rfc6750#section-1.3). If omitted, no check is performed on incoming requests - avoid unsecured webhooks, especially when your service is publicly exposed!
* `PORT`:  
  The port to listen for webhook connections on. Optional, defaults to `3999`.
