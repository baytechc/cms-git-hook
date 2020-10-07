require('dotenv').config();

// Date for currently running job
const date = new Date();
const datestamp = Number(date);

console.log('Git update starting with datestamp: ' + datestamp);

const nodegit = require('nodegit');
const path = require('path');

const execa = require('execa');


// Build command to execute on the repo
if (process.env.REPO_BUILD_COMMAND) {
  console.log('Need to specify a build command (set REPO_BUILD_COMMAND)');
  process.exit();
}

// Git Credentials
const creds = (url, userName) => nodegit.Cred.sshKeyNew(
  'git' /*process.env.GIT_USERNAME*/,
  process.env.GIT_PUBKEY_PATH,
  process.env.GIT_PRIVKEY_PATH,
  process.env.GIT_PRIVKEY_PASSPHRASE
);

// Push branch to origin
let origin;
const pushToOrigin = async (branch = '*') => {
  return await origin.push([
    // Local snapshot to remote snapshot
    `refs/heads/${branch}:refs/heads/${branch}`
  ],{
    callbacks: {
      credentials: creds
    }
  });
}



(async function(){

console.log('Setting up repo...');

let local = "./_repo";
let repo;
try {
  // Make sure the repo URL is SSH (not http:!) to avoid weird auth errors!
  const url = process.env.GIT_REPO_SSH;
  const branch = process.env.GIT_LIVE_BRANCH;

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
    process.exit();
  }

}

// Connect to origin and update references
let reflist;
try {
  origin = await nodegit.Remote.lookup(repo, 'origin');

  console.log(`Updating origin refs...`);
  await origin.fetch(
    // Refspecs: fetch all
    ['refs/heads/*:refs/remotes/origin/*'],
    // Fetch options
    { callbacks: { credentials: creds } }
  );
  origin.pruneRefs();

  reflist = await origin.referenceList();
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
      await pushToOrigin(snap);
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

  commit = await repo.createCommit("HEAD", author, committer, commitmessage, oid, [parent]);
  console.log(`Committed as "${commitmessage}" to ${commit}`);

  await pushToOrigin(snap);
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

// TODO: commit
// TODO: push

})();

