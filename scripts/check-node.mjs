// Read-only prerequisite check; unlike runtime:check, this does not patch dependencies.
if (Number(process.versions.node.split(".")[0]) !== 24) {
  console.error(
    `Studio's scripts and tests require Node 24; current runtime is ${process.versions.node}. Select an installed Node 24 (for example, nvm use) and run the command again.`,
  );
  process.exit(1);
}
