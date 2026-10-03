export type MemorySaveReceipt = {
  source: { id: string; collection: string; status: string };
  duplicate?: boolean;
};

export function memorySaveFeedback(
  receipts: MemorySaveReceipt[],
  spaces: Array<{ id: string; name: string }>,
) {
  if (!receipts.length) return null;
  const added = receipts.filter((receipt) => !receipt.duplicate);
  const relevant = added.length ? added : receipts;
  const destinations = [
    ...new Set(
      relevant.map(
        (receipt) =>
          spaces.find((space) => space.id === receipt.source.collection)?.name ||
          receipt.source.collection,
      ),
    ),
  ].join(" & ");
  const duplicates = receipts.length - added.length;
  let notice =
    added.length === 0
      ? `Already saved in ${destinations}.`
      : added.length === 1
        ? `Saved to ${destinations} on this Mac.`
        : `${added.length} items saved to ${destinations} on this Mac.`;
  if (added.length && duplicates) notice += ` ${duplicates} already in memory.`;
  if (receipts.some((receipt) => receipt.source.status === "error"))
    notice += " Some saved items need indexing attention.";
  else if (receipts.some((receipt) => receipt.source.status === "indexing"))
    notice += " Indexing in the background.";
  return { notice, added: added.length, sourceId: relevant[0].source.id };
}
