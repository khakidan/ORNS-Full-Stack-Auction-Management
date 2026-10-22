#!/usr/bin/env node
/**
 * Apps Script deploy tooling. Run through npm:
 *
 *   npm run gas:stamp            Recompute each project's fingerprint; write
 *                                Version.gs and server/generated/appsScriptVersions.ts.
 *                                Run after editing any file under scripts/GoogleAppsScriptsCode/.
 *   npm run gas:deploy [name..]  Push each project (default: all three) from its
 *                                repo folder, create a version, and point the app's
 *                                API deployment at it. Refuses if the stamp is stale.
 *   npm run gas:check            Download each project's deployed version and compare
 *                                it file by file with the repo. Exit code 1 on any difference.
 *
 * Uses clasp 3.4.1 through npx (a global 2.x clasp crashes on Node 26) and
 * clasp's own sign-in (`npx @google/clasp@3.4.1 login`).
 * Each project folder's .clasp.json holds its scriptId and deploymentId.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PROJECTS, REPO_ROOT, SCRIPTS_ROOT, GENERATED_TS, VERSION_FILE,
  deployedFiles, fingerprint, stampedVersion, versionFileSource, generatedTsSource,
} from "./fingerprint.mjs";

// Run through npx, not installed into the project: as a devDependency its
// own google-auth-library copy reshuffled the app's googleapis types.
const CLASP = ["npx", "--yes", "@google/clasp@3.4.1"];

function clasp(args, cwd, { capture = false } = {}) {
  const result = spawnSync(CLASP[0], [...CLASP.slice(1), ...args], { cwd, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.status !== 0) {
    throw new Error(`clasp ${args.join(" ")} failed${capture ? `:\n${result.stdout}${result.stderr}` : ""}`);
  }
  return capture ? result.stdout : "";
}

function claspConfig(project) {
  return JSON.parse(fs.readFileSync(path.join(SCRIPTS_ROOT, project, ".clasp.json"), "utf8"));
}

function pickProjects(names) {
  if (names.length === 0) return Object.keys(PROJECTS);
  for (const name of names) {
    if (!PROJECTS[name]) throw new Error(`Unknown project "${name}". Choose from: ${Object.keys(PROJECTS).join(", ")}`);
  }
  return names;
}

function stamp() {
  const versions = {};
  for (const project of Object.keys(PROJECTS)) {
    versions[project] = fingerprint(project);
    fs.writeFileSync(path.join(SCRIPTS_ROOT, project, VERSION_FILE), versionFileSource(versions[project]));
    console.log(`${project}: ${versions[project]}`);
  }
  fs.mkdirSync(path.dirname(GENERATED_TS), { recursive: true });
  fs.writeFileSync(GENERATED_TS, generatedTsSource(versions));
  console.log(`Wrote Version.gs in each project and ${path.relative(REPO_ROOT, GENERATED_TS)}. Commit them.`);
}

function deploy(names) {
  const projects = pickProjects(names);
  const stale = projects.filter((p) => stampedVersion(p) !== fingerprint(p));
  if (stale.length) {
    throw new Error(`Version.gs is out of date for ${stale.join(", ")}. Run \`npm run gas:stamp\`, commit, then deploy.`);
  }
  for (const project of projects) {
    const { deploymentId } = claspConfig(project);
    if (!deploymentId) throw new Error(`${project}/.clasp.json has no deploymentId.`);
    const dir = path.join(SCRIPTS_ROOT, project);
    console.log(`\n=== ${project} (${PROJECTS[project].label}) - version ${stampedVersion(project)}`);
    clasp(["push", "--force"], dir);
    const out = clasp(["create-version", `${PROJECTS[project].label} ${stampedVersion(project)}`], dir, { capture: true });
    const versionNumber = out.match(/(\d+)\s*$/m)?.[1];
    if (!versionNumber) throw new Error(`Couldn't read the new version number from: ${out}`);
    console.log(`Created version ${versionNumber}`);
    clasp(["update-deployment", deploymentId, "--versionNumber", versionNumber, "--description", `${PROJECTS[project].label} v${versionNumber} (${stampedVersion(project)})`], dir);
  }
  console.log("\nDeployed. Run `npm run gas:check` to confirm the live scripts match the repo.");
}

function check(names) {
  let differences = 0;
  for (const project of pickProjects(names)) {
    const config = claspConfig(project);
    const listing = clasp(["list-deployments"], path.join(SCRIPTS_ROOT, project), { capture: true });
    const versionNumber = listing.split("\n").find((l) => l.includes(config.deploymentId))?.match(/@(\d+)/)?.[1];
    if (!versionNumber) {
      console.log(`${project}: couldn't find deployment ${config.deploymentId}`);
      differences++;
      continue;
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `gas-check-${project}-`));
    fs.writeFileSync(path.join(tmp, ".clasp.json"), JSON.stringify({ scriptId: config.scriptId, rootDir: "", scriptExtensions: [".gs"], jsonExtensions: [".json"] }));
    clasp(["pull", "--versionNumber", versionNumber], tmp, { capture: true });

    const live = fs.readdirSync(tmp).filter((f) => f !== ".clasp.json").sort();
    const repo = [...deployedFiles(project), VERSION_FILE].sort();
    const problems = [];
    for (const f of live) if (!repo.includes(f)) problems.push(`only live: ${f}`);
    for (const f of repo) if (!live.includes(f)) problems.push(`only in repo: ${f}`);
    for (const f of repo.filter((f) => live.includes(f))) {
      const a = fs.readFileSync(path.join(tmp, f), "utf8").replace(/\r\n/g, "\n").trim();
      const b = fs.readFileSync(path.join(SCRIPTS_ROOT, project, f), "utf8").replace(/\r\n/g, "\n").trim();
      if (f === "appsscript.json" ? JSON.stringify(JSON.parse(a)) !== JSON.stringify(JSON.parse(b)) : a !== b) problems.push(`differs: ${f}`);
    }
    fs.rmSync(tmp, { recursive: true, force: true });

    if (problems.length) {
      differences++;
      console.log(`${project}: deployed version ${versionNumber} does NOT match the repo`);
      for (const p of problems) console.log(`  - ${p}`);
    } else {
      console.log(`${project}: deployed version ${versionNumber} matches the repo (${stampedVersion(project)})`);
    }
  }
  if (differences) process.exitCode = 1;
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "stamp") stamp();
  else if (command === "deploy") deploy(args);
  else if (command === "check") check(args);
  else {
    console.error("Usage: node scripts/apps-script/cli.mjs <stamp|deploy|check> [project...]");
    process.exitCode = 2;
  }
} catch (error) {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
}
