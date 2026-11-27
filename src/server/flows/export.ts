/**
 * Export file name (contract section 6): flow name lowercased, runs of
 * non-[a-z0-9] become "-", trimmed, at most 60 characters, "flow" when empty.
 * The result only ever holds [a-z0-9-], so it is safe inside the quoted
 * Content-Disposition filename.
 */
export function exportSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug === "" ? "flow" : slug;
}

export function exportFileName(name: string): string {
  return `${exportSlug(name)}.n8n.json`;
}
