import type { ActivityLog } from "../../types/domain";
import { Badge } from "../../components/ui/Badge";
import { formatDateTime, formatRelativeTime } from "../../utils/format";
import { ACTIVITY_META } from "./meta";
import styles from "./ActivityList.module.css";

interface ActivityListProps {
  items: ActivityLog[];
}

/** 活动记录列表：时间、类型、摘要与相关项目。 */
export function ActivityList({ items }: ActivityListProps) {
  return (
    <ul className={styles.list}>
      {items.map((item) => {
        const meta = ACTIVITY_META[item.eventType];
        const Icon = meta.icon;
        return (
          <li key={item.id} className={styles.row}>
            <span className={styles.icon} aria-hidden="true">
              <Icon size={15} />
            </span>
            <div className={styles.main}>
              <span className={styles.description}>{item.summary}</span>
              <span className={styles.project}>
                {item.projectId
                  ? item.projectName ?? "已删除的项目"
                  : "应用"}
              </span>
            </div>
            <Badge tone={meta.tone}>{meta.label}</Badge>
            <time
              className={styles.time}
              dateTime={item.createdAt}
              title={formatDateTime(item.createdAt)}
            >
              {formatRelativeTime(item.createdAt)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}
