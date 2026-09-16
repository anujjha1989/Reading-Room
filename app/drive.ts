export function driveDownloadUrl(id: string) {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
}
