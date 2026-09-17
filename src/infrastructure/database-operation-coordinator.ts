import { t } from "../i18n";

export type DatabaseOperationKind =
  | "database-write"
  | "feed-update"
  | "translation"
  | "llm-review"
  | "recommendation";

type ReleaseOperation = () => void;

const CONFLICTING_OPERATION_KINDS: ReadonlyMap<
  DatabaseOperationKind,
  readonly DatabaseOperationKind[]
> = new Map([
  ["llm-review", ["recommendation"]],
  ["recommendation", ["llm-review"]],
]);

export class DatabaseOperationCoordinator {
  private activeOperations = 0;
  private transitionActive = false;
  private readonly activeKinds = new Map<DatabaseOperationKind, number>();

  acquireOperation(kind: DatabaseOperationKind): ReleaseOperation {
    if (this.transitionActive) {
      throw new Error(t("ui.the_database_is_being_switched_or_restored_try_again_shortly"));
    }
    const conflictingKind = CONFLICTING_OPERATION_KINDS.get(kind)?.find(
      (candidate) => (this.activeKinds.get(candidate) ?? 0) > 0,
    );
    if (conflictingKind) {
      throw new Error(t("ui.recommendation_and_llm_review_cannot_run_at_the_same_time"));
    }
    this.activeOperations += 1;
    this.activeKinds.set(kind, (this.activeKinds.get(kind) ?? 0) + 1);
    return this.releaseOnce(() => {
      this.activeOperations -= 1;
      const activeCount = (this.activeKinds.get(kind) ?? 1) - 1;
      if (activeCount > 0) {
        this.activeKinds.set(kind, activeCount);
      } else {
        this.activeKinds.delete(kind);
      }
    });
  }

  tryAcquireOperation(
    kind: DatabaseOperationKind,
  ): ReleaseOperation | null {
    try {
      return this.acquireOperation(kind);
    } catch {
      return null;
    }
  }

  acquireTransition(): ReleaseOperation {
    if (this.transitionActive) {
      throw new Error(t("ui.the_database_is_being_switched_or_restored_try_again_shortly"));
    }
    if (this.activeOperations > 0) {
      throw new Error(t("ui.a_background_task_is_running_wait_for_it_to_finish_before_switching_or_r"));
    }
    this.transitionActive = true;
    return this.releaseOnce(() => {
      this.transitionActive = false;
    });
  }

  isTransitioning(): boolean {
    return this.transitionActive;
  }

  isOperationActive(kind: DatabaseOperationKind): boolean {
    return (this.activeKinds.get(kind) ?? 0) > 0;
  }

  private releaseOnce(release: () => void): ReleaseOperation {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      release();
    };
  }
}
