import { t } from "../i18n";

export type DatabaseOperationKind =
  | "database-write"
  | "feed-update"
  | "translation"
  | "llm-review"
  | "recommendation";

type ReleaseOperation = () => void;

export class DatabaseOperationCoordinator {
  private activeOperations = 0;
  private transitionActive = false;

  acquireOperation(_kind: DatabaseOperationKind): ReleaseOperation {
    if (this.transitionActive) {
      throw new Error(t("ui.the_database_is_being_switched_or_restored_try_again_shortly"));
    }
    this.activeOperations += 1;
    return this.releaseOnce(() => {
      this.activeOperations -= 1;
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
