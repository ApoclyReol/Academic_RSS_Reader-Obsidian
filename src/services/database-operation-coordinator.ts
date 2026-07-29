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
      throw new Error("数据库正在切换或恢复，请稍后再试");
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
      throw new Error("数据库正在切换或恢复，请稍后再试");
    }
    if (this.activeOperations > 0) {
      throw new Error("后台任务正在执行，请等待任务完成后再切换或恢复数据库");
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
