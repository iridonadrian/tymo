import type { SaveType } from "./schemas";
import { parseUrl } from "./url";

const VIDEO_HOSTS = [
  "youtube.com",
  "youtu.be",
  "vimeo.com",
  "twitch.tv",
  "loom.com",
  "dailymotion.com",
];
const SOCIAL_HOSTS = [
  "twitter.com",
  "x.com",
  "reddit.com",
  "instagram.com",
  "tiktok.com",
  "threads.net",
  "bsky.app",
  "linkedin.com",
  "facebook.com",
  "news.ycombinator.com",
  "mastodon.social",
];
const MAP_HOSTS = ["maps.google.com", "maps.apple.com", "openstreetmap.org", "maps.app.goo.gl"];
const BOOK_HOSTS = ["goodreads.com", "openlibrary.org"];
const MOVIE_HOSTS = ["imdb.com", "letterboxd.com", "themoviedb.org"];
const REPO_HOSTS = ["github.com", "gitlab.com", "codeberg.org", "bitbucket.org"];
const GITHUB_NON_REPO = new Set([
  "features",
  "topics",
  "collections",
  "trending",
  "marketplace",
  "settings",
  "orgs",
  "sponsors",
  "about",
  "pricing",
  "explore",
  "login",
  "notifications",
  "search",
]);

function hostMatches(host: string, list: string[]) {
  return list.some((h) => host === h || host.endsWith("." + h));
}

export interface DetectHints {
  ogType?: string;
  jsonLdTypes?: string[];
  contentType?: string;
}

/** Heuristic content type from URL (+ optional page hints). Never throws. */
export function detectType(rawUrl: string | null | undefined, hints: DetectHints = {}): SaveType {
  if (!rawUrl) return "note";
  const u = parseUrl(rawUrl);
  if (!u) return "link";
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname.toLowerCase();
  const ct = hints.contentType?.toLowerCase() ?? "";

  if (ct.startsWith("application/pdf") || path.endsWith(".pdf")) return "pdf";
  if (ct.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif)$/.test(path)) return "image";
  if (/\.(docx?|pptx?|xlsx?|odt|rtf|epub)$/.test(path)) return "document";

  if (hostMatches(host, REPO_HOSTS)) {
    const [owner, repo] = u.pathname.split("/").filter(Boolean);
    if (owner && repo && !GITHUB_NON_REPO.has(owner.toLowerCase())) return "repo";
  }
  if (hostMatches(host, VIDEO_HOSTS)) return "video";
  if (hostMatches(host, SOCIAL_HOSTS)) return "social";
  if (hostMatches(host, MAP_HOSTS) || (host.startsWith("google.") && path.startsWith("/maps"))) {
    return "place";
  }
  if (hostMatches(host, BOOK_HOSTS)) return "book";
  if (hostMatches(host, MOVIE_HOSTS)) return "movie";

  const ld = (hints.jsonLdTypes ?? []).map((t) => t.toLowerCase());
  if (ld.includes("recipe")) return "recipe";
  if (ld.includes("book")) return "book";
  if (ld.includes("movie") || ld.includes("tvseries")) return "movie";
  if (
    ld.some((t) =>
      ["restaurant", "place", "localbusiness", "touristattraction", "hotel"].includes(t),
    )
  ) {
    return "place";
  }
  if (ld.includes("product") || ld.includes("productgroup")) return "product";
  if (ld.includes("softwareapplication") || ld.includes("webapplication")) return "tool";
  if (ld.includes("videoobject")) return "video";

  const og = hints.ogType?.toLowerCase() ?? "";
  if (og.startsWith("video")) return "video";
  if (og === "product" || og === "og:product" || og.startsWith("product.")) return "product";
  if (og === "book" || og.startsWith("books.")) return "book";
  if (og.startsWith("video.movie") || og.startsWith("video.tv_show")) return "movie";
  if (og === "article" || ld.some((t) => t.endsWith("article") || t === "blogposting")) {
    return "article";
  }
  return "link";
}

/** Extracts owner/repo for GitHub-like URLs (used as type-specific metadata). */
export function repoInfo(rawUrl: string): { owner: string; repo: string } | null {
  const u = parseUrl(rawUrl);
  if (!u || !hostMatches(u.hostname.replace(/^www\./, ""), REPO_HOSTS)) return null;
  const [owner, repo] = u.pathname.split("/").filter(Boolean);
  if (!owner || !repo || GITHUB_NON_REPO.has(owner.toLowerCase())) return null;
  return { owner, repo: repo.replace(/\.git$/, "") };
}
