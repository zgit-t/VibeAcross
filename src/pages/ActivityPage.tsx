import { useMemo, useState } from "react";
import { Inbox, Trash2 } from "lucide-react";
import { useActivity, useActivityFeed } from "../context/ActivityContext";
import { PageHeader } from "../components/layout/PageHeader";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { EmptyState } from "../components/ui/EmptyState";
import { Notice } from "../components/ui/Notice";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { ActivityList } from "../features/activity/ActivityList";
import { ACTIVITY_META, ACTIVITY_TYPES } from "../features/activity/meta";
import { clearActivity } from "../services/activity";
import { isDesktopRuntime, toErrorMessage } from "../services/backend";
import type { ActivityType } from "../types/domain";
import styles from "./ActivityPage.module.css";

type TypeFilter = "all" | ActivityType;

const FILTER_OPTIONS: Array<{ value: TypeFilter; label: string }> = [
  { value: "all", label: "全部" },
  ...ACTIVITY_TYPES.map((type) => ({
    value: type,
    label: ACTIVITY_META[type].label,
  })),
];

/** 最近活动页面：展示应用内真实操作记录。 */
export function ActivityPage() {
  const desktopAvailable = isDesktopRuntime();
  const { bumpRevision } = useActivity();
  const [filter, setFilter] = useState<TypeFilter>("all");
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eventType = filter === "all" ? null : filter;
  const selector = useMemo(() => ({ eventType }), [eventType]);
  const feed = useActivityFeed(selector, 20);

  async function handleClear() {
    setClearing(true);
    setError(null);
    try {
      await clearActivity(null);
      setConfirmClear(false);
      bumpRevision();
    } catch (cause) {
      setError(toErrorMessage(cause, "清理活动记录失败。"));
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Activity"
        description="VibeAcross 内的操作记录，保存在本机。"
        actions={
          <Button
            variant="secondary"
            icon={<Trash2 size={15} aria-hidden="true" />}
            onClick={() => setConfirmClear(true)}
            disabled={!desktopAvailable || feed.total === 0}
          >
            清理记录
          </Button>
        }
      />

      {!desktopAvailable && (
        <Notice tone="warning" title="桌面运行时不可用">
          活动记录保存在本地 SQLite，仅在桌面应用中可用。
        </Notice>
      )}

      {error && <Notice tone="danger">{error}</Notice>}
      {feed.error && <Notice tone="danger">{feed.error}</Notice>}

      <div className={styles.toolbar}>
        <SegmentedControl
          ariaLabel="按活动类型筛选"
          size="sm"
          options={FILTER_OPTIONS}
          value={filter}
          onChange={setFilter}
        />
        <span className={styles.count}>{feed.total} 条记录</span>
      </div>

      <div className={styles.listWrap}>
        {feed.items.length > 0 ? (
          <>
            <ActivityList items={feed.items} />
            {feed.hasMore && (
              <div className={styles.more}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void feed.loadMore()}
                  disabled={feed.loading}
                >
                  {feed.loading ? "加载中…" : "加载更多"}
                </Button>
              </div>
            )}
          </>
        ) : feed.loading ? null : filter === "all" ? (
          <EmptyState
            icon={Inbox}
            title="暂无活动记录"
            description="创建项目、配置工具或管理任务后，记录会显示在这里。"
          />
        ) : (
          <EmptyState
            icon={Inbox}
            title="该分类下暂无记录"
            description="切换其他分类查看。"
            action={
              <Button variant="secondary" onClick={() => setFilter("all")}>
                查看全部
              </Button>
            }
          />
        )}
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="清理全部活动记录？"
        description="将删除本机保存的全部活动历史，此操作无法撤销。"
        confirmLabel="清理"
        tone="danger"
        busy={clearing}
        onConfirm={handleClear}
        onClose={() => setConfirmClear(false)}
      />
    </div>
  );
}
