# Deployment history

Reading Room keeps two complementary records:

- Git commits explain how the source changed.
- `/Volumes/Seagate/ReadingRoom/deployment-history/vN.json` records what was actually deployed.

After a successful deployment, `deploy/deploy.sh` writes a JSON manifest containing the version, timestamp, Git commit and branch, build mode, asset checksums, verification results, and rollback location. These generated records live outside Git so deploying does not dirty the source tree.

When the source tree is clean apart from the tracked deployment counter, the script also creates an annotated Git tag named `deploy-vN`. If genuine source edits are uncommitted, deployment still works and the manifest records `sourceTreeClean: false`, but no potentially misleading tag is created.

The human-readable summary is maintained in [`CHANGELOG.md`](../CHANGELOG.md). It describes user-visible changes; the JSON records and Git history retain the technical detail.

## Useful commands

```bash
# Recent source history
git log --oneline --decorate -20

# Versions tied to commits
git tag --list 'deploy-v*' --sort=-version:refname

# Inspect one deployment
cat /Volumes/Seagate/ReadingRoom/deployment-history/v90.json
```
