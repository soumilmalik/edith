// Tasks are sorted by their `order` field (ascending = higher on the list).
// Uses fractional/midpoint indexing so inserting or dragging a single task
// only ever needs to write that one task's order - never a full renumber of
// the list.

export function sortByOrder(tasks) {
  return [...tasks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

// Where a newly-added task (with the given AI-assigned priority) should slot
// into the CURRENT order - in front of the first existing task with a lower
// priority, so new high-priority tasks jump above low-priority ones without
// disturbing groups the user has manually reordered elsewhere in the list.
export function computeInsertOrder(existingTasks, priority) {
  const sorted = sortByOrder(existingTasks);
  if (sorted.length === 0) return 0;
  const targetIdx = sorted.findIndex((t) => (t.priority ?? 3) < priority);
  if (targetIdx === -1) {
    return (sorted[sorted.length - 1].order ?? 0) + 1;
  }
  const prevOrder = targetIdx > 0 ? sorted[targetIdx - 1].order ?? 0 : (sorted[targetIdx].order ?? 0) - 1;
  return (prevOrder + (sorted[targetIdx].order ?? 0)) / 2;
}

// Where a manually-dragged task should land, given its new neighbors in the
// already-reordered array (the task itself sits at `index`).
export function computeDragOrder(reordered, index) {
  const prev = reordered[index - 1];
  const next = reordered[index + 1];
  const prevOrder = prev ? prev.order ?? 0 : next ? (next.order ?? 0) - 1 : 0;
  const nextOrder = next ? next.order ?? 0 : prev ? (prev.order ?? 0) + 1 : 1;
  return (prevOrder + nextOrder) / 2;
}
