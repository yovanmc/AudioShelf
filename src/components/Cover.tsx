import { useEffect, useState } from "react";
import { getAuthorCover, getWorkCover, fileUrl } from "../lib/api";
import { colorFor, initials } from "../lib/avatar";

/** Inline-styled colour+initials placeholder (the app ships no stylesheet). */
export function Swatch({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 6,
        marginRight: 8,
        flex: "0 0 auto",
        background: colorFor(name),
        color: "#fff",
        fontSize: Math.round(size * 0.43),
        fontWeight: 600,
      }}
    >
      {initials(name)}
    </span>
  );
}

// Resolved cover paths cached across mounts (virtualized rows remount on scroll).
// Value: asset cache path, or null when there's no cover.
const coverCache = new Map<string, string | null>();

/**
 * Lazy cover image for an author or work. Shows the colour+initials Swatch while loading
 * and whenever there is no cover — so there is never a layout shift or a broken image.
 */
export function Cover({
  kind,
  id,
  name,
  size = 28,
}: {
  kind: "author" | "work";
  id: number;
  name: string;
  size?: number;
}) {
  const key = `${kind}:${id}`;
  const [path, setPath] = useState<string | null>(() => coverCache.get(key) ?? null);

  useEffect(() => {
    let alive = true;
    if (coverCache.has(key)) {
      setPath(coverCache.get(key) ?? null);
      return;
    }
    // Promise.resolve(...) tolerates test mocks that return undefined.
    Promise.resolve(kind === "author" ? getAuthorCover(id) : getWorkCover(id))
      .then((p) => {
        const v = p ?? null;
        coverCache.set(key, v);
        if (alive) setPath(v);
      })
      .catch(() => {
        coverCache.set(key, null);
        if (alive) setPath(null);
      });
    return () => {
      alive = false;
    };
  }, [key, id, kind]);

  if (path) {
    return (
      <img
        src={fileUrl(path)}
        alt=""
        width={size}
        height={size}
        style={{
          width: size,
          height: size,
          borderRadius: 6,
          marginRight: 8,
          flex: "0 0 auto",
          objectFit: "cover",
          display: "inline-block",
          verticalAlign: "middle",
        }}
      />
    );
  }
  return <Swatch name={name} size={size} />;
}
