export function driveDownloadUrl(id: string) {
  // Reference Room ids are the Drive id with a "ref-" prefix.
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id.replace(/^ref-/, ""))}`;
}
