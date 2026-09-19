import fs from "node:fs";
import path from "node:path";

const [catalogPath, manifestPath, nextPath, summaryPath] = process.argv.slice(2);
if (![catalogPath, manifestPath, nextPath, summaryPath].every(Boolean)) {
  throw new Error("usage: drive-scan.mjs CATALOG MANIFEST NEXT SUMMARY");
}

const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (!Array.isArray(catalog) || !Array.isArray(manifest)) throw new Error("invalid JSON input");

const supported = new Set(["EPUB", "PDF", "MOBI", "AZW", "AZW3", "CBR", "CBZ", "DOC", "DOCX", "RTF", "TXT", "FDX"]);
const documentation = /^(?:read[ _-]?me|chronology|license|metadata|notes?|about|cover|contents?|index)(?:\b|[._-])/i;
const existingIds = new Set(catalog.map((entry) => entry.id));

const normalize = (value = "") => value.normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const tidy = (value = "") => value
  .replace(/&amp;?/gi, "&")
  .replace(/&#0*39;|&_?039;/gi, "'")
  .replace(/[_]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const looksLikePerson = (value = "") => {
  const cleaned = tidy(value).replace(/[.,]/g, " ");
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 7 || /\d/.test(cleaned)) return false;
  if (/\b(book|series|collection|novel|stories|edition|volume|complete|press|publisher)\b/i.test(cleaned)) return false;
  return words.filter((word) => /^[A-Z][A-Za-z'’.-]*$/.test(word) || /^(?:and|&)$/.test(word)).length >= Math.ceil(words.length * 0.6);
};

const canonicalPerson = (value) => {
  const cleaned = tidy(value);
  const comma = cleaned.match(/^([^,]+),\s*(.+)$/);
  return comma ? `${comma[2]} ${comma[1]}`.trim() : cleaned;
};

function metadataFor(filePath) {
  const extension = path.extname(filePath).slice(1).toUpperCase();
  const directories = path.dirname(filePath).split("/").filter(Boolean);
  let stem = tidy(path.basename(filePath, path.extname(filePath)))
    .replace(/\s+-\s+libgen(?:\.li)?(?:\s+\d+)?$/i, "")
    .replace(/\s*\((?:retail|ebook|converted|fixed|v?\d+(?:\.\d+)?)\)\s*$/i, "")
    .trim();
  let title = stem;
  let author = "";
  let series = "";
  let seriesPosition = "";

  const leadingSeries = title.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (leadingSeries) {
    const label = tidy(leadingSeries[1]);
    const position = label.match(/(?:book|vol(?:ume)?)?\s*#?(\d+(?:\.\d+)?)\s*$/i);
    seriesPosition = position?.[1] || "";
    series = tidy(label.replace(/(?:book|vol(?:ume)?)?\s*#?\d+(?:\.\d+)?\s*$/i, ""));
    title = leadingSeries[2];
  }

  const parts = title.split(/\s+[-–—]\s+/).map(tidy).filter(Boolean);
  if (parts.length >= 2 && /^\d+(?:\.\d+)?$/.test(parts[0])) {
    seriesPosition ||= parts.shift();
  }
  if (parts.length >= 2 && looksLikePerson(parts[0])) {
    author = canonicalPerson(parts.shift());
    title = parts.join(" — ");
  } else if (parts.length >= 2) {
    const last = parts.at(-1).replace(/\s*\(\d{4}\)\s*$/, "");
    if (looksLikePerson(last)) {
      author = canonicalPerson(last);
      parts.pop();
    }
    title = parts.join(" — ");
  }

  const inlineSeries = title.match(/^\[([^\]]+)\]\s*[-–—]?\s*(.+)$/);
  if (inlineSeries) {
    const label = tidy(inlineSeries[1]);
    const position = label.match(/(\d+(?:\.\d+)?)\s*$/);
    seriesPosition ||= position?.[1] || "";
    series ||= tidy(label.replace(/\d+(?:\.\d+)?\s*$/, ""));
    title = inlineSeries[2];
  }

  title = tidy(title)
    .replace(/^\d+(?:\.\d+)?\s*[-–—:]\s*/, "")
    .replace(/\s*\(\d{4}(?:,[^)]*)?\)\s*$/, "")
    .replace(/\s*\((?:epub|pdf|mobi)\)\s*$/i, "")
    .trim() || stem;

  const source = directories[0] === "Scripts" ? "Scripts" : "Books";
  const lowerPath = filePath.toLowerCase();
  const category = source === "Scripts" ? "Script"
    : /graphic novels?|comics?/.test(lowerPath) ? "Graphic Novel"
      : /non[ -]?fiction|biograph|history|true crime|technical/.test(lowerPath) ? "Non-Fiction"
        : /poetry|poems?/.test(lowerPath) ? "Poetry"
          : /fiction|novels?|short stories|fantasy|classics/.test(lowerPath) ? "Fiction"
            : "General";

  const genericFolders = /^(?:Books|Scripts|Fiction|Non-Fiction|General|Collections|New Books)$/i;
  const collections = directories.slice(1).filter((folder) => !genericFolders.test(folder));
  if (!series) {
    const parent = directories.at(-1) || "";
    if (/\b(series|trilogy|chronicles|saga|cycle)\b/i.test(parent)) {
      series = tidy(parent.replace(/\([^)]*\)|\b(?:complete|ebook|epub|pdf|series|collection)\b/gi, ""));
    }
  }

  const incomplete = !author;
  const workKey = incomplete
    ? `${normalize(title)}||${path.basename(filePath)} `
    : `${normalize(title)}|${normalize(author)}`;
  return { title, author, series, seriesPosition, incomplete, workKey, extension, source, collections, category };
}

const additions = [];
for (const file of manifest) {
  if (!file || file.IsDir || typeof file.Path !== "string" || typeof file.ID !== "string") continue;
  if (!/^(?:Books|Scripts)\//.test(file.Path) || existingIds.has(file.ID)) continue;
  const extension = path.extname(file.Path).slice(1).toUpperCase();
  if (!supported.has(extension) || documentation.test(path.basename(file.Path))) continue;
  const meta = metadataFor(file.Path);
  additions.push({
    id: file.ID,
    title: meta.title,
    author: meta.author,
    series: meta.series,
    ...(meta.seriesPosition ? { seriesPosition: meta.seriesPosition } : {}),
    incomplete: meta.incomplete,
    workKey: meta.workKey,
    format: meta.extension,
    source: meta.source,
    collections: meta.collections,
    category: meta.category,
    path: path.dirname(file.Path).split("/").join(" / "),
    url: `https://drive.google.com/file/d/${file.ID}/view?usp=drivesdk`,
    modified: file.ModTime || new Date().toISOString(),
  });
  existingIds.add(file.ID);
}

const updated = [...catalog, ...additions];
if (new Set(updated.map((entry) => entry.id)).size !== updated.length) throw new Error("duplicate file IDs");
if (additions.length) fs.writeFileSync(nextPath, `${JSON.stringify(updated)}\n`);
fs.writeFileSync(summaryPath, `${JSON.stringify({ before: catalog.length, added: additions.length, after: updated.length, titles: additions.map((entry) => entry.title) }, null, 2)}\n`);
console.log(`Reading Room scan: ${additions.length} new file(s); ${updated.length} total catalogue entries`);
