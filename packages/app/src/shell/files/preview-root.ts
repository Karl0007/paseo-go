// F6 (review, security lane): the preview screen's workspace root must come from the
// workspace descriptor resolved via serverId+workspaceId. A URL-borne root can be
// forged by any `paseogo://` deep link, and pre-fix it OUTRANKED the descriptor —
// handing a malicious link arbitrary-path reads on the host. Descriptor always
// wins; the param survives only where no descriptor exists (offline favorites).
export function resolvePreviewRoot(input: {
  paramRoot?: string | null;
  descriptorRoot?: string | null;
}): string {
  const descriptor = (input.descriptorRoot ?? "").trim();
  if (descriptor.length > 0) return descriptor;
  return (input.paramRoot ?? "").trim();
}
