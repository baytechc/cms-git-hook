CMS Git Hook
============

Tool for receiving webhooks from a CMS (e.g. content change hooks) and regenerating the sources of a static page in a Git repository. This tool is not concerned with generating the built (and deployed) website, but with synchronizing the CMS data into a Git repo, allowing for change tracking and reviews.

The first version is based on pulling information out of a Strapi REST endpoint and pushing Markdown/Nunjucks sources into an Eleventy site skeleton, but it should be rather straightforward to adopt to different tools and usecases. This version is focusing on interacting with a GitHub server, but uses `nodegit` and standard git integrations so might also just work with other Git hosts with few or no modifications.

*Very, very beta. May break, or eat your laundry. You have been warned.*


## Configuration

Configure using the following ENV variables.

* `GIT_REPO_SSH`:  
  Repository URL to pull/push to. Make sure you specify an SSH URL (the code will break on HTTP(S) Git URLs!). E.g.: `git@github.com:user/repo.git`
* `GIT_LIVE_BRANCH`:  
  The branch that CMS content gets committed into. This is the branch we use for creating the initial local repository from, but the code writes new commits to individual snapshot branches.
* `GIT_PUBKEY_PATH` / `GIT_PRIVKEY_PATH`:  
  Path to the SSH private and public keys to use for authenticating with GitHub (`id_rsa`/`id_rsa.pub`)
* `GIT_PRIVKEY_PASSPHRASE`:  
  If the private key requires a passphrase to unlock, you can pass it in here.
* `REPO_BUILD_COMMAND`:  
  The command to execute on the repo to pull in the updated CMS content, e.g. `npm run get-cms-content` or similar.
