How does it work?
=================

When triggered (e.g. manually or via incoming webhook) we clone the configured target repo locally, install its dependencies, and build a "snapshot". The repo knows exactly what it needs to do to refresh its contents and build this snapshot, we are just making sure this build mechanism is triggered and then take the generated artifacts and commit them into a special `snapshot` branch.

Snapshot branches translate changes in the CMS into trackable, diffable content updates in a repository. This not only makes it possible to review (and preview) CMS changes before they are deployed but also provides a sort of "version control": API output is saved in the source files and data can be recovered from these logs when something goes awry in the CMS.


## Repository workflow

- If a local repo doesn't exist, create one from the `live` branch or the remote repo
- Pull remote origin references, try to find an existing `snapshot` branch
  - For now, there should always really be one or no `snapshot` branch (merged PR-s delete the remote snapshot)
  - If we do find a `snapshot` branch on the remote, we check it out locally and make sure its up to date with origin
  - If there is no `snapshot` branch, we create one from the `live` branch locally and push it up to the origin
  - If we already had the latest `snapshot` branch locally make sure it's up-to-date with origin (force pull/replace if needed)
- Now we have a `snapshot` branch checked out locally, we need to trigger regeneration of the website content
  - We `npm install` the repo, make sure we have everything to run the configured build command
  - We execute the repo's build command
    - If there are no new or updated files, we are done, no need for updating/snapshotting
    - If there are new or changed files we add all the changes to a new "snapshot build" commit and push it up to origin
  - Origin regenerates the preview based on these recent changes and prepares the `snapshot` branch for merging (publication) on the `live` branch.
  - Change review & publication is usually done via a PR (pull request) mechanism which is currently not automated (but could be in the future)


## Glossary

- `live` branch:  
  This branch is the main branch holding all CMS content. We expect this branch to be "live", continously deployed to the live version of the webpage. The live branch is usually updated through `snapshot` PR-s, pull requests merging one or more CMS changes into the branch.
- `snapshot` branch:  
  A branch named as `snap-<numeric_timestamp>`, containing the latest updates from the CMS. All changes from the CMS commit data into the latest snapshot branch until it's merged back to the `live` branch.