// Home-page shelves.
//
// This module was reconstructed from the hand-edited LibraryClient bundle that
// had been running in production since July. The logic is deliberately kept
// identical to what was deployed — same regexes, same ordering, same edge
// cases — so that rebuilding from source does not silently change the shelves.
//
// Collection membership comes from the catalogue, never from an invented list
// of books. Booker winners are checked against a title list because the Booker
// folder includes nominees as well as winners.
// Reference: https://thebookerprizes.com/the-booker-library/features/full-list-of-booker-prize-winners-shortlisted-and-longlisted-authors

export type ShelfBook = {
  id: string;
  title: string;
  originalTitle?: string;
  author?: string;
  series?: string;
  category?: string;
  path?: string;
  modified?: string;
  formats: string[];
  collections: string[];
  searchText: string;
  // Presentation-only fields. Grouping never rewrites a book's id, so
  // favourites, bookmarks and reading progress survive untouched.
  rrShelfLabel?: string;
  rrEditions?: ShelfBook[];
  rrGroupTitle?: string;
  rrGroupAuthor?: string;
};

export type ShelfState = { favorite?: boolean; lastOpened?: number | null; progressLabel?: string | null };
export type Shelf = { title: string; items: ShelfBook[]; compact?: boolean };

type Artwork = Record<string, { found?: boolean; url?: string; embedded?: string } | undefined>;

export function shelfKey(text: string | undefined) {
  return (text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Corrects presentation after grouping, so that existing book IDs — and
// therefore favourites, bookmarks and reading progress — are preserved.
export function reviewBooks<T extends ShelfBook>(books: T[], rawRows: { id: string; title?: string; author?: string; path?: string }[]): T[] {
  const rawById = new Map((rawRows || []).map((b) => [b.id, b]));

  // "Favorite Authors / <name>" folders tell us which strings are author names.
  const authorNames = new Set<string>();
  (rawRows || []).forEach((b) => {
    const m = (b.path || "").match(/Favorite Authors \/ ([^/]+)$/);
    if (m) authorNames.add(shelfKey(m[1]));
  });
  const titlesToAuthors = new Map<string, Set<string>>();
  (rawRows || []).forEach((b) => {
    if (b.author && authorNames.has(shelfKey(b.author))) {
      const k = shelfKey(b.title);
      if (!titlesToAuthors.has(k)) titlesToAuthors.set(k, new Set());
      titlesToAuthors.get(k)!.add(b.author);
    }
  });

  const reviewed = books.map((book) => {
    let title = book.title;
    let author = book.author || "";
    if (/^(Pulitzer Prize|Booker Prize|Fiction|Non-Fiction|General)$/i.test(author)) author = "";

    const raw = rawById.get(book.id) || book;
    const folder = ((raw as { path?: string }).path || "")
      .split(" / ")
      .pop()!
      .replace(/^\d+\s*-\s*/, "")
      .replace(/\s*\((Retail|Longlist)\)/gi, "");
    const folderPair = folder.match(/^(.+?) by (.+)$/);
    if (folderPair && !/^(Jimmy Corrigan|Persepolis)/i.test(title)) {
      title = folderPair[1];
      author = folderPair[2];
    }

    if (!author && titlesToAuthors.get(shelfKey(title))?.size === 1) {
      author = Array.from(titlesToAuthors.get(shelfKey(title))!)[0];
    }
    // The title is a known author name and the author is not: they are reversed.
    if (author && authorNames.has(shelfKey(title)) && !authorNames.has(shelfKey(author))) {
      const swap = title;
      title = author;
      author = swap;
    }

    const swapped = [
      "Alice Hoffman", "Annie Proulx", "Denis Johnson", "Elmore Leonard", "H G Bissinger",
      "Jay Mc Inerney", "Joyce Carol Oates", "Kate Atkinson", "Larry Mc Murtry", "Scott Turow", "T C Boyle",
    ];
    if (swapped.includes(title) && author) {
      const temp = title;
      title = author;
      author = temp;
    }

    const fixes: [RegExp, string, string][] = [
      [/^A Heartbreaking Work of Staggeri/i, "A Heartbreaking Work of Staggering Genius", "Dave Eggers"],
      [/^America The Book A Citizen/i, "America (The Book)", "Jon Stewart"],
      [/^And the Band Played On Politics/i, "And the Band Played On", "Randy Shilts"],
      [/^Bridget Jones s Diary/i, "Bridget Jones’s Diary", "Helen Fielding"],
      [/^Nickel and Dimed On/i, "Nickel and Dimed", "Barbara Ehrenreich"],
      [/^The Spirit Catches You and You Fall Down/i, "The Spirit Catches You and You Fall Down", "Anne Fadiman"],
      [/^(Absolute Watchmen|Watchmen full)/i, "Watchmen", "Alan Moore & Dave Gibbons"],
      [/^Alison Bechdel 2006/i, "Fun Home", "Alison Bechdel"],
      [/^Big City Bright Lights$/i, "Bright Lights, Big City", "Jay McInerney"],
      [/^Jesus Son$/i, "Jesus’ Son", "Denis Johnson"],
      [/^2001 a Space Odyssey$/i, "2001: A Space Odyssey", "Arthur C. Clarke"],
      [/^A bend in the river$/i, "A Bend in the River", "V. S. Naipaul"],
      [/^1984$/, "1984", "George Orwell"],
      [/^A Clockwork Orange\b/i, "A Clockwork Orange", "Anthony Burgess"],
      [/^The-great-gatsby$/i, "The Great Gatsby", "F. Scott Fitzgerald"],
      [/^The-da-vinci-code$/i, "The Da Vinci Code", "Dan Brown"],
      [/^A Problem From Hell America/i, "A Problem from Hell", "Samantha Power"],
      [/^Behind the Beautiful Forevers Life/i, "Behind the Beautiful Forevers", "Katherine Boo"],
      [/^Guns, Germs, and Steel The Fates/i, "Guns, Germs, and Steel", "Jared Diamond"],
      [/^The Swerve How the World/i, "The Swerve", "Stephen Greenblatt"],
      [/^The Noonday Demon An Atlas/i, "The Noonday Demon", "Andrew Solomon"],
    ];
    fixes.forEach((f) => {
      if (f[0].test(title)) {
        title = f[1];
        author = f[2];
      }
    });

    // Strips release-team tags, not meaningful volume or edition information.
    title = title
      .replace(/\s*\((?:Minutemen|Retail|Illustrated|ebook|epub)[^)]*\)/gi, "")
      .replace(/\s*\((?:19|20)\d\d,[^)]*\d{10,}[^)]*\)/g, "")
      .replace(/\s*\[(?:retail|ebook|epub)[^\]]*\]/gi, "")
      .replace(/^(.+),\s*(The|A|An)$/i, "$2 $1")
      .replace(/_/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const split = title.match(/^(.+?)\s+-\s+([A-Z][A-Za-z.’' -]+)$/);
    if (split && split[2].trim().split(/\s+/).length >= 2 && (!author || shelfKey(author) === shelfKey(split[2]))) {
      title = split[1];
      author = split[2];
    }

    author = author.replace(/\bMc (\w)/g, "Mc$1").replace(/\bTim O Brien\b/g, "Tim O’Brien").trim();

    if (/^\d[\d\s-]{7,}$/.test(title)) {
      title = "Unidentified book";
      author = "Metadata needs review";
    }

    return {
      ...book,
      title,
      author,
      searchText: book.searchText + " " + title.toLowerCase() + " " + author.toLowerCase(),
    };
  });

  // A book with no author can borrow one from another copy of the same work.
  const byTitle = new Map<string, Map<string, string>>();
  const workKey = (title: string) => shelfKey(title.replace(/\s+(?:a\s+)?novel$/i, ""));
  reviewed.forEach((b) => {
    if (b.author) {
      const key = workKey(b.title);
      if (!byTitle.has(key)) byTitle.set(key, new Map());
      byTitle.get(key)!.set(shelfKey(b.author).replace(/\s/g, ""), b.author);
    }
  });
  return reviewed.map((b) => {
    const authors = byTitle.get(workKey(b.title));
    if (!b.author && authors?.size === 1) {
      const author = Array.from(authors.values())[0];
      return { ...b, author, searchText: b.searchText + " " + author.toLowerCase() };
    }
    return b;
  });
}

export function cleanCompleteName(name: string) {
  const aliases: Record<string, string> = {
    "alexander dumas": "Alexandre Dumas",
    "bronte sisters": "Brontë Sisters",
    "the bronte sisters": "Brontë Sisters",
    "jrr tolkein": "J. R. R. Tolkien",
    "j r r tolkien": "J. R. R. Tolkien",
    "sir arthur conan doyle": "Arthur Conan Doyle",
    "henry wadsworth": "Henry Wadsworth Longfellow",
    "f scott fitzgerald uk": "F. Scott Fitzgerald",
    "lord tennyson alfred": "Alfred, Lord Tennyson",
    "william makepeace thacke": "William Makepeace Thackeray",
    "rabindranath tagore general press": "Rabindranath Tagore",
    "song of ice and fire": "A Song of Ice and Fire",
    "song of ice and fire 1 5": "A Song of Ice and Fire",
    "wheel of time": "The Wheel of Time",
    "wheel of time compendium": "The Wheel of Time",
    "swami vivekananda volume": "Swami Vivekananda",
    "dennis lehane": "Dennis Lehane",
  };
  const key = shelfKey(name);
  if (/^masters of (the )?short story/.test(key)) return "Masters of the Short Story";
  return aliases[key] || name;
}

// Drive-era ids. They no longer match anything now that ids are path-derived,
// but they are harmless and are kept so the behaviour is unchanged.
const SPECIAL_COMPLETE_LABELS: Record<string, string> = {
  "1e4OvpHKa57ZWHWc2e9ELxfuztvl5DLst": "Flannery O’Connor",
  "1b-d0W67PPHKuBABPNXe25WoGtbBZiB4_": "Arabian Nights",
  "1cwgCUjYjDbHD_5CLunfFW-37vb8WDA4R": "Brontë Sisters",
  "1bY7If-Q_9VcV3vPcGvVjK3tqijVlBpmU": "Emily Dickinson",
  "1bSxHSrtl8hEhygCGBdV3_coyJnaLakw4": "Henry Wadsworth Longfellow",
  "1cCatu2PzEX0keD-qsg7Ba8x47HKa-aCM": "Evelyn Waugh",
  "1cmnsFuW2zTGWgq-9YstYKmvrPJ2NXcki": "Sherlock Holmes",
};
const MAUPASSANT_ID = "1GFk-LrSv6rkiY0UcyKFzXsieGREh8lBp";

export function completeLabel(book: ShelfBook): string {
  if (book.rrShelfLabel) return cleanCompleteName(book.rrShelfLabel);
  let raw = book.originalTitle || book.title;
  if (SPECIAL_COMPLETE_LABELS[book.id]) return SPECIAL_COMPLETE_LABELS[book.id];

  const embeddedAuthor = raw.match(/\bcomplete\s+collection\s*\{\s*([^}]+?)\s*\}/i);
  if (embeddedAuthor) return cleanCompleteName(embeddedAuthor[1].trim());

  raw = raw
    .replace(/^Delphi\s+/i, "")
    .replace(/\s*\(Illustrated\)/gi, "")
    .replace(/,\s*The\b.*$/i, "")
    .replace(/,\s*A$/i, "");
  if (/^(?:the\s+)?complete\s+(?:novels|stories|poems)$/i.test(raw) && book.author) return book.author;
  raw = raw
    .replace(/^(?:the\s+)?complete\s+(.+?)\s+collection$/i, "$1")
    .replace(/^(?:the\s+)?complete\s+(?!(?:works|collection)\b)/i, "")
    .replace(/\s+complete\s+(?:tales and poems|short stories)$/i, "")
    .replace(/\s*[-–—]\s*(?:Delphi|Maste).*$/i, "");
  let name = raw
    .replace(/^(?:the\s+)?complete\s+(?:works|collection)(?:\s+of)?\s*/i, "")
    .replace(/\s*(?:[-–—:]\s*)?(?:the\s+)?complete\s+(?:works|collection)(?:\s*[-–—].*|\s+\d.*)?$/i, "")
    .replace(/\.(epub|mobi|azw3?|pdf)$/i, "")
    .replace(/^[-–—:\s]+|[-–—:\s]+$/g, "")
    .trim();
  if (name === "Robert Louis Stevenso") name = "Robert Louis Stevenson";
  if (name === "Oxford Shakespeare") name = "William Shakespeare";
  return cleanCompleteName(name || book.author || book.series || book.title);
}

export function cardTitle(book: ShelfBook): string {
  if (book.rrShelfLabel) return book.rrEditions && !book.rrGroupTitle ? completeLabel(book) : book.rrShelfLabel;
  return /\bcomplete works\b/i.test(book.title) ? completeLabel(book) : book.title;
}

export function recentlyOpened<T extends ShelfBook>(books: T[], states: Record<string, ShelfState>): T[] {
  return books
    .filter((book) => Number(states[book.id]?.lastOpened) > 0)
    .sort((a, b) => Number(states[b.id].lastOpened) - Number(states[a.id].lastOpened));
}

export function continueProgress(state: ShelfState | undefined) {
  // Always a percentage. This used to fall through to the raw label, so a book
  // whose progress was not "Page X of Y" showed "In progress" or "UNO" instead
  // of a number. Try the page form, then any bare percentage in the label, then
  // the stored fraction; only show 0% when there is genuinely nothing.
  const label = state && state.progressLabel ? String(state.progressLabel) : "";
  const page = label.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
  if (page && Number(page[2]) > 0) {
    return Math.max(1, Math.min(100, Math.round((Number(page[1]) / Number(page[2])) * 100))) + "%";
  }
  const percent = label.match(/(\d+(?:\.\d+)?)\s*%/);
  if (percent) return Math.max(1, Math.min(100, Math.round(Number(percent[1])))) + "%";
  const fraction = state && typeof (state as { progress?: unknown }).progress === "number"
    ? (state as { progress: number }).progress : null;
  if (fraction !== null && fraction > 0) {
    return Math.max(1, Math.min(100, Math.round(fraction <= 1 ? fraction * 100 : fraction))) + "%";
  }
  return "0%";
}

// Groups display cards only: original ids, copies and progress remain untouched.
export function groupShelf(books: ShelfBook[]): ShelfBook[] {
  const groups: ShelfBook[] = [];
  books.forEach((book) => {
    if (book.rrEditions) {
      groups.push(book);
      return;
    }
    const title = shelfKey(cardTitle(book).replace(/\s+(?:a\s+)?novel$/i, ""));
    const author = shelfKey(book.author).replace(/\s/g, "");
    let group = groups.find((g) => g.rrGroupTitle === title && (!author || !g.rrGroupAuthor || author === g.rrGroupAuthor));
    if (!group) {
      group = { ...book, rrGroupTitle: title, rrGroupAuthor: author, rrEditions: [] };
      groups.push(group);
    }
    if (!group.rrGroupAuthor && author) {
      group.rrGroupAuthor = author;
      group.author = book.author;
    }
    group.rrEditions!.push(book);
  });
  return groups.map((g) => {
    if (g.rrGroupTitle && g.rrEditions!.length === 1) {
      const single = { ...g };
      delete single.rrEditions;
      return single;
    }
    return g;
  });
}

// Artwork is published by the enrichment layer as a global. It may not be
// present (a cold load, or the script blocked), in which case there are no
// candidate covers and the caller falls back to /api/cover.
function artwork(): Artwork | undefined {
  return (globalThis as { rrArtwork?: Artwork }).rrArtwork;
}

export function coverOptions(book: ShelfBook): string[] {
  const art = artwork();
  if (!art) return [];
  if (book.rrEditions && !book.rrGroupTitle) {
    const portrait = art["author:" + completeLabel(book)];
    return portrait?.found && portrait.url ? [portrait.url] : [];
  }
  const editions = book.rrEditions || [book];
  const urls: string[] = [];
  editions.forEach((b) => {
    const entry = art["book:" + b.id];
    if (entry?.found) {
      if (entry.embedded) urls.push(entry.embedded);
      if (entry.url) urls.push(entry.url);
    }
  });
  return Array.from(new Set(urls));
}

const BOOKER_WINNER_TITLES = "Flesh|Orbital|Prophet Song|The Seven Moons of Maali Almeida|The Promise|Shuggie Bain|Girl Woman Other|The Testaments|Milkman|Lincoln in the Bardo|The Sellout|A Brief History of Seven Killings|The Narrow Road to the Deep North|The Luminaries|Bring Up the Bodies|The Sense of an Ending|The Finkler Question|Wolf Hall|The White Tiger|The Gathering|The Inheritance of Loss|The Sea|The Line of Beauty|Vernon God Little|Life of Pi|True History of the Kelly Gang|The Blind Assassin|Disgrace|Amsterdam|The God of Small Things|Last Orders|The Ghost Road|How Late It Was How Late|Paddy Clarke Ha Ha Ha|The English Patient|Sacred Hunger|The Famished Road|Possession|The Remains of the Day|Oscar and Lucinda|Moon Tiger|The Old Devils|The Bone People|Hotel du Lac|Life and Times of Michael K|Schindler's Ark|Midnight's Children|Rites of Passage|Offshore|The Sea The Sea|Staying On|Saville|Heat and Dust|The Conservationist|Holiday|The Siege of Krishnapur|G|In a Free State|The Elected Member|Troubles|Something to Answer For".split("|");

export function homeShelves(
  books: ShelfBook[],
  states: Record<string, ShelfState>,
  rawRows: { id: string; title?: string }[],
): Shelf[] {
  const originals = new Map((rawRows || []).map((b) => [b.id, b]));
  const winners = BOOKER_WINNER_TITLES.map(shelfKey);

  const inCollection = (book: ShelfBook, pattern: RegExp) => (book.collections || []).some((c) => pattern.test(c));
  const sorted = (items: ShelfBook[]) => items.slice().sort((a, b) => a.title.localeCompare(b.title));

  let complete: ShelfBook[] = books
    .filter((b) => {
      if (/handbook of novel writing/i.test(b.title) || b.id === MAUPASSANT_ID) return false;
      return (
        b.formats.some((f) => /^(EPUB|MOBI|AZW3?|KF8|PDF|TXT|DOCX?|RTF)$/i.test(f)) &&
        (/\bcomplete (?:works|collection)\b/i.test([b.title, b.originalTitle, b.series].filter(Boolean).join(" ")) ||
          inCollection(b, /^Complete Works$/i))
      );
    })
    .map((b) => {
      const original = originals.get(b.id);
      return { ...b, rrShelfLabel: completeLabel({ ...b, originalTitle: original ? original.title : b.originalTitle }) };
    })
    .sort((a, b) => completeLabel(a).localeCompare(completeLabel(b)));

  const groups = new Map<string, ShelfBook>();
  complete.forEach((book) => {
    const key = completeLabel(book)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    if (!groups.has(key)) groups.set(key, { ...book, rrEditions: [] });
    groups.get(key)!.rrEditions!.push(book);
  });
  complete = Array.from(groups.values());

  const booker = books.flatMap((b) => {
    if (!inCollection(b, /booker/i)) return [];
    const names = [b.title, b.originalTitle, b.author].filter(Boolean).map((name) => shelfKey(name!.replace(/\s*[[(].*$/, "")));
    const index = winners.findIndex((winner) => names.includes(winner));
    return index < 0 ? [] : [{ ...b, rrShelfLabel: BOOKER_WINNER_TITLES[index] }];
  });

  return [
    { title: "Favorites", items: books.filter((b) => states[b.id] && states[b.id].favorite) },
    { title: "Complete Works", items: complete, compact: true },
    { title: "Booker Prize Winners", items: sorted(booker) },
    { title: "Pulitzer Prize Winners — Fiction", items: sorted(books.filter((b) => inCollection(b, /^Pulitzer Prize\s*[—–-]\s*Fiction$/i))) },
    { title: "Pulitzer Prize Winners — NonFiction", items: sorted(books.filter((b) => inCollection(b, /^Pulitzer Prize\s*[—–-]\s*(General\s+)?Non[ -]?Fiction$/i))) },
    { title: "Pulitzer Prize Winners — Biography", items: sorted(books.filter((b) => inCollection(b, /^Pulitzer Prize\s*[—–-]\s*Biography$/i))) },
    { title: "Pulitzer Prize Winners — History", items: sorted(books.filter((b) => inCollection(b, /^Pulitzer Prize\s*[—–-]\s*History$/i))) },
    { title: "Books You Must Read Before You Die", items: sorted(books.filter((b) => inCollection(b, /^Books (?:You Must |to )Read Before You Die$/i))) },
    { title: "The New Classics", items: sorted(books.filter((b) => inCollection(b, /^The New Classics$/i))) },
    { title: "50 Books To Read Before You Reach 50", items: sorted(books.filter((b) => inCollection(b, /^50 Books to Read Before (?:You Reach )?50$/i))) },
  ];
}
