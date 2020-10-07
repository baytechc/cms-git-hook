require('dotenv').config();
// TODO: maybe skip this on module includes?

// Date for currently running job
const date = new Date();
const datestamp = Number(date);

// Global configuration (used when running from the commandline)
// When called as an import, these are used as the default config
// (but the caller can override all properties)
const globalConfig = {
  publicKey:      process.env.GIT_PUBKEY_PATH,
  privateKey:     process.env.GIT_PRIVKEY_PATH,
  privateKeyPass: process.env.GIT_PRIVKEY_PASSPHRASE,
  buildCommand:   process.env.REPO_BUILD_COMMAND,
  repoUrl:        process.env.GIT_REPO_SSH,
  liveBranch:     process.env.GIT_LIVE_BRANCH,
  // currently unused
  gitUser:        process.env.GIT_USERNAME,
}


const nodegit = require('nodegit');
const path = require('path');

const execa = require('execa');


// Git Credentials
function makeCreds(cfg) {
  return (url, userName) => nodegit.Cred.sshKeyNew(
    'git', // for GitHub this is 'git', not cfg.gitUser
    cfg.publicKey,
    cfg.privateKey,
    cfg.privateKeyPass
  );
}

// Origin-specific abstractions
function setOrigin(origin, cfg) {
  const creds = makeCreds(cfg);

  return ({
    // Get nodegit origin object reference
    get() { return origin },

    // Fetch all from origin
    async fetch(branch = '*') {
      await origin.fetch([
        // Refspecs: by default fetch all
        `refs/heads/${branch}:refs/heads/${branch}`
        ],
        // Fetch options
        { callbacks: { credentials: creds } }
      );

      origin.pruneRefs();
    },

    // Push to origin
    async push(branch = '*') {
      await origin.push([
        // Refspecs: by default push all
        `refs/heads/${branch}:refs/heads/${branch}`
        ],
        // Fetch options
        { callbacks: { credentials: creds } }
      );
    }
  });
}


const run = async function(cfg) {
// Merge Global Config with the overrides in cfg
cfg = Object.assign({}, globalConfig, cfg);

// Generate credentials callback using the current config
const creds = makeCreds(cfg);

// Build command to execute on the repo
if (!cfg.buildCommand) {
  console.log('Need to specify a build command (set REPO_BUILD_COMMAND)');
  return new Error('Unspecified build command!');
}


console.log('Setting up repo...');

let local = "./_repo";
let repo;
try {
  // Make sure the repo URL is SSH (not http:!) to avoid weird auth errors!
  const url = cfg.repoUrl;
  const branch = cfg.liveBranch;

  repo = await nodegit.Clone(url, local, {
    checkoutBranch: branch,

    fetchOpts: {
      callbacks: { credentials: creds }
    }
  });

  console.log(`Cloned ${url} to ${repo.workdir()}`);
  console.log(`Active branch is: ${branch}`);
}
catch (e) {
  if (e.toString().includes('exists and is not an empty directory')) {
    console.log(`Repo already exists.`);

    // Open the existing repo
    repo = await nodegit.Repository.open(local);
  } else {
    console.log(e);
    return e;
  }

}

// Connect to origin and update references
let origin, reflist;
try {
  // Connect to origin
  // (Note: the result will be a custom abstraction over the nodegit object)
  origin = setOrigin(
    await nodegit.Remote.lookup(repo, 'origin'),
    cfg
  );

  console.log(`Updating origin refs...`);
  await origin.fetch();

  // TODO: move this into setOrigin?
  reflist = await origin.get().referenceList();
  reflist = reflist.map(r => ({
    ref: r,
    name: r.name(),
    oid: r.oid().tostrS()
  }))
  console.log(reflist.map(r => r.name));
}
catch(e) {
  console.log(e);
}

// Try and find the latest snapshot branch and update that:
// * in reflist: 'refs/heads/snap-XXXXXXXX',
// * and also:   'refs/pull/N/head'
// If the OID of snapshot === OID of largest N pull head, that
// means that it is tracking the PR and we can push to it. After
// merging into live snapshot branches are deleted on origin, so
// we need to create a new snap branch push it and a new PR must
// be created.

let snap, snapmax = 0;
let liveBranchRef, snapBranchRef;
for (let r of reflist) {
  // find all snapshot branches
  if (r.name.match(/^refs\/heads\/snap-\d+/)) {
    let snapid = parseInt(r.name.slice(16), 10);

    // find latest snapshot
    if (snapid > snapmax) {
      snapmax = snapid;
      snap = `snap-${snapid}`;
      snapBranchRef = r.ref;
      console.log(`Found snapshot: ${r.name}`);
    }
  }

  // Store the reference to the live branch on origin
  if (r.name === 'refs/heads/live') liveBranchRef = r.ref;
}

// Check if local snapshot branch is up to date with remote snapshot
let workingBranchRef;

if (snapBranchRef) {
  try {
    let currentBranchRef = await repo.getCurrentBranch();

    if (currentBranchRef.shorthand() === snap) {
      workingBranchRef = currentBranchRef;
    }

    console.log(`On ${workingBranchRef.shorthand()} branch`);

    //TODO: Ensure local branch is up to date
    //console.log(currentBranchRef.cmp(snapBranchRef.oid()))
    console.log(`Local branch is up to date.`);

  }
  catch (e) {
    console.log(e);
  }
}

// No local snapshot, so pull the remote one or create a new snapshot
// If there was no remote snapshot push this new branch
if (!workingBranchRef) {
  console.log("Creating local snapshot branch...");

  // (Re)Create the local snapshot branch
  snap = snap || `snap-${datestamp}`;

  try {
    workingBranchRef = await repo.createBranch(
      snap,

      // commit ref, will point to the snapshot branch's HEAD, if one
      // exists, otherwise we'll derive it from the live branch
      (snapBranchRef || liveBranchRef).oid(),

      // force overwrite any existing branch with this name
      true
    );

    console.log(`Created ${workingBranchRef.shorthand()}`);

    // Push to origin if no snapshot branch yet
    if (!snapBranchRef) {
      await origin.push(snap);
      //TODO: assign to snapBranchRef

      console.log(`Pushed new ${workingBranchRef.shorthand()} to origin`);
    }

    // Set upstream
    await nodegit.Branch.setUpstream(workingBranchRef, `origin/${snap}`);
    console.log(`Branch set to track origin/${snap}`);
  }
  catch (e) {
    console.log(e);
  }

// Check out the snapshot branch or create a local branch that
// tracks the snapshot
} else {}

// Switch to branch
try {
  await repo.checkoutBranch(
    snap,
    {
      // Overwrite local changes
      checkoutStrategy: nodegit.Checkout.STRATEGY.FORCE
    }
  );

  let upstream = await nodegit.Branch.upstream(workingBranchRef);
  console.log(`The upstream for ${snap} is:`, upstream.name());
}
catch (e) {
  console.log(e);
}


// TODO: Pull
// https://github.com/nodegit/nodegit/blob/master/examples/pull.js

// TODO: (optional) auto-merge main


// Install npm dependencies
console.log('Running npm install...');
let npmInstall = await execa.command('npm install --no-audit', {
  cwd: process.cwd()+'/_repo'
});
console.log(npmInstall.stdout);
// TODO: error handling

// Generate new snapshot
let cmd = process.env.REPO_BUILD_COMMAND;

console.log(`Build started by: ${cmd}`);
let runSnapshot = await execa.command(cmd, {
  cwd: process.cwd()+'/_repo',
  env: process.env
});
// Show files recognized by Eleventy
console.log(runSnapshot);
// TODO: error handling


// Repository status after snapshot build
console.log('Checking for changed files...');
let index, status;

try {
  // Refresh the index
  index = await repo.refreshIndex();

  // List repo status
  let statusList = await repo.getStatus();


  status = statusList.map( file => ({
    file: file,
    path: file.path(),

    untracked:   !!file.isNew(),
    modified:    !!file.isModified(),
    typechanged: !!file.isTypechange(),
    renamed:     !!file.isRenamed(),
    ignored:     !!file.isIgnored(),
  }));
}
catch (e) {
  console.log(e);
}

console.log(status);

// No changes
if (!status.length) {
  console.log('No changes detected.');
  return;
}

// Add to index & commit
console.log(`Adding ${status.length} changed path(s) index...`);
try {
  await index.addAll(
    status.map(f => f.path)
  );

  // Write the new index
  await index.write();

  // Generate oid
  let oid = await index.writeTree();
  console.log(`New tree: ${oid}`);

  // Get repo HEAD commit for the parent of the new HEAD
  let parent = await nodegit.Reference.nameToId(repo, "HEAD");
  console.log(`repo HEAD: ${parent}`);

  let author = nodegit.Signature.now(
    "RustFest CMS Git Sync", "infra@rustfest.eu"
  );
  let committer = nodegit.Signature.now(
    "Bay Area Tech Club", "contact@baytech.community"
  );

  let commitmessage = `${date.toISOString()} snapshot build`;

  let commit = await repo.createCommit("HEAD", author, committer, commitmessage, oid, [parent]);
  console.log(`Committed as "${commitmessage}" to ${commit}`);

  await origin.push(snap);
  console.log(`Pushed changes to origin/${snap}`);
  console.log('Click here to start a pull request:\n'
    + `https://github.com/RustFestEU/rustfest.global/compare/live...${snap}?expand=1`
  );
  // TODO: check if there's an active PR and link to that
  // (by having a snap-* branch and a /pull/N ref that points to the same commit)
}
catch (e) {
  console.log(e);
}

}

if (require.main === module) {
  console.log('Manual CMS Git Sync with datestamp: ' + datestamp);

  run().catch(e => console.error(e));
} else {
  module.export = run
}
