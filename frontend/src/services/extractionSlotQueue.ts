/** Slot-based FIFO extraction scheduler (max concurrent slots + retries). */

export const EXTRACTION_MAX_SLOTS = 3;
/** 1 initial attempt + 2 retries */
export const EXTRACTION_MAX_ATTEMPTS = 3;

export type SlotQueueItem = {
  id: string;
  status: string;
  kind?: string;
  file?: File;
  stagedId?: string;
  permanentlyFailed?: boolean;
};

type ProcessResult = {
  ok: boolean;
  /** When true, extraction finished synchronously (rare); otherwise wait for terminal status. */
  settled?: boolean;
  errorMessage?: string;
};

export type ExtractionSlotQueueOptions = {
  getItems: () => SlotQueueItem[];
  /** Start extraction for one file. Must not start the same id twice concurrently. */
  processItem: (item: SlotQueueItem, attempt: number) => Promise<ProcessResult>;
  /** Move a failed item to the end as ready for another attempt. */
  requeueForRetry: (itemId: string, attempt: number, maxAttempts: number) => void;
  /** Mark permanently failed after exhausting attempts. */
  markPermanentlyFailed: (itemId: string, attempts: number, message?: string) => void;
  onSlotReleased?: () => void;
};

/**
 * Maintains FIFO scheduling across a fixed number of processing slots.
 * Does not own upload/extraction internals — only decides who runs next.
 */
export class ExtractionSlotQueue {
  private readonly active = new Set<string>();
  private readonly starting = new Set<string>();
  private readonly scheduled = new Set<string>();
  private readonly attempts = new Map<string, number>();
  private pumping = false;
  private pumpAgain = false;

  constructor(private readonly options: ExtractionSlotQueueOptions) {}

  get activeCount() {
    return this.active.size;
  }

  getAttempts(itemId: string) {
    return this.attempts.get(itemId) ?? 0;
  }

  isActive(itemId: string) {
    return this.active.has(itemId) || this.starting.has(itemId);
  }

  /** True only after start succeeded and we are waiting on polled completion. */
  isAwaitingTerminal(itemId: string) {
    return this.active.has(itemId);
  }

  /** Schedule one or more ready items (FIFO preserved by queue order). */
  schedule(itemIds: string[]) {
    for (const id of itemIds) {
      if (!id) continue;
      const attempts = this.attempts.get(id) ?? 0;
      if (attempts >= EXTRACTION_MAX_ATTEMPTS) continue;
      this.scheduled.add(id);
    }
    void this.pump();
  }

  /** Drop scheduling for a removed queue row. */
  forget(itemId: string) {
    this.scheduled.delete(itemId);
    this.active.delete(itemId);
    this.starting.delete(itemId);
    this.attempts.delete(itemId);
  }

  /**
   * Call when a slot-held item reaches a terminal extraction status.
   * `failed` releases the slot and either requeues (FIFO end) or permanently fails.
   */
  notifyTerminal(itemId: string, outcome: "done" | "failed", errorMessage?: string) {
    if (!this.active.has(itemId) && !this.starting.has(itemId)) return;

    this.active.delete(itemId);
    this.starting.delete(itemId);
    this.options.onSlotReleased?.();

    if (outcome === "done") {
      this.scheduled.delete(itemId);
      void this.pump();
      return;
    }

    const attempts = this.attempts.get(itemId) ?? 0;
    if (attempts >= EXTRACTION_MAX_ATTEMPTS) {
      this.scheduled.delete(itemId);
      this.options.markPermanentlyFailed(
        itemId,
        attempts,
        errorMessage || `Failed after ${EXTRACTION_MAX_ATTEMPTS} attempts.`,
      );
      void this.pump();
      return;
    }

    // Retry after other waiting files (FIFO end).
    this.scheduled.add(itemId);
    this.options.requeueForRetry(itemId, attempts, EXTRACTION_MAX_ATTEMPTS);
    void this.pump();
  }

  private nextWaiting(): SlotQueueItem | null {
    const items = this.options.getItems();
    for (const item of items) {
      if (!this.scheduled.has(item.id)) continue;
      if (item.permanentlyFailed) continue;
      if (item.status !== "ready") continue;
      if (!item.file && !item.stagedId) continue;
      if (this.active.has(item.id) || this.starting.has(item.id)) continue;
      const attempts = this.attempts.get(item.id) ?? 0;
      if (attempts >= EXTRACTION_MAX_ATTEMPTS) continue;
      return item;
    }
    return null;
  }

  async pump() {
    if (this.pumping) {
      this.pumpAgain = true;
      return;
    }
    this.pumping = true;
    try {
      do {
        this.pumpAgain = false;
        while (this.active.size + this.starting.size < EXTRACTION_MAX_SLOTS) {
          const next = this.nextWaiting();
          if (!next) break;
          void this.startSlot(next);
          // Yield so startSlot can mark starting before the next pick.
          await Promise.resolve();
        }
      } while (this.pumpAgain);
    } finally {
      this.pumping = false;
    }
  }

  private async startSlot(item: SlotQueueItem) {
    if (this.active.has(item.id) || this.starting.has(item.id)) return;

    this.starting.add(item.id);
    const attempt = (this.attempts.get(item.id) ?? 0) + 1;
    this.attempts.set(item.id, attempt);

    try {
      const result = await this.options.processItem(item, attempt);
      this.starting.delete(item.id);

      if (!result.ok) {
        // Treat start/upload failure like an extraction failure for retry accounting.
        this.active.add(item.id);
        this.notifyTerminal(item.id, "failed", result.errorMessage);
        return;
      }

      this.active.add(item.id);
      if (result.settled) {
        this.notifyTerminal(item.id, "done");
      }
    } catch (error) {
      this.starting.delete(item.id);
      this.active.add(item.id);
      this.notifyTerminal(
        item.id,
        "failed",
        error instanceof Error ? error.message : "Extraction failed.",
      );
    }
  }
}
