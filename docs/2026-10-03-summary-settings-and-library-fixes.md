# Home Books release v181

Source: `868b5b3` (application changes in `ca1a744`).

- Saved title and author corrections take precedence over inferred folder metadata and shelf labels.
- Section lists render one metadata block and one menu button.
- Incremental scans read the configured local drop folder and preserve existing local-file mappings and path-derived IDs. The Anthony Bourdain collection was imported successfully: 9608 → 9609 catalogue entries.
- The web Settings page supports the native summary queue API. The iPhone update is committed separately at `3f95572`, with its device release pending the free-development signing slot constraint.

Validation: six focused checks passed (rendered Settings/list/title-save flows, metadata precedence, local import and repeat-scan deduplication), native simulator Settings checks passed, and all nine live mobile browser checks passed. The authenticated public HTTPS origin on port 8443 passed rendered Settings checks in both themes. Asset and scanner hashes were verified by the deployment pipeline.

v180 was rolled back after the broader reader audit failed. The same failure reproduced on v179: the test used the retired Bookmarks panel label and treated optional missing-cover responses as application errors. The audit was updated to the current Bookmarks and highlights label and accepts only the expected cover-endpoint 404 fallback. The corrected audit passes on v179 and v181.

Rollback archive: `/Volumes/Seagate/ReadingRoom/deployment-backups/20261003-065451-before-v181`. Deployment manifest: `/Volumes/Seagate/ReadingRoom/deployment-history/v181.json`. No book files, saved summaries, or reading progress were deleted.
