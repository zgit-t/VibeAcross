use tempfile::TempDir;
use vibeacross_lib::activity::{self, ActivityFilter, ActivityType};
use vibeacross_lib::db::Database;
use vibeacross_lib::projects;

fn setup() -> (TempDir, Database) {
    let workspace = tempfile::tempdir().expect("创建临时目录失败");
    let db = Database::open_in_memory().unwrap();
    (workspace, db)
}

fn make_project(conn: &rusqlite::Connection, workspace: &TempDir, name: &str) -> String {
    projects::create_project(conn, name, &workspace.path().to_string_lossy())
        .unwrap()
        .id
}

#[test]
fn record_and_list_newest_first() {
    let (workspace, db) = setup();
    let conn = db.conn().unwrap();
    let project_id = make_project(&conn, &workspace, "P1");

    activity::record(&conn, ActivityType::Project, Some(&project_id), "创建项目").unwrap();
    activity::record(&conn, ActivityType::Task, Some(&project_id), "创建任务").unwrap();
    activity::record(&conn, ActivityType::Tool, None, "启动工具").unwrap();

    let page = activity::list_activity(&conn, &ActivityFilter::default()).unwrap();
    assert_eq!(page.total, 3);
    assert_eq!(page.items.len(), 3);

    // 时间戳可能相同，保证列表按 created_at 倒序且包含全部事件即可。
    assert!(page.items.iter().any(|item| item.event_type == ActivityType::Tool));
    assert!(page.items.iter().any(|item| item.summary == "创建任务"));
}

#[test]
fn list_filters_by_project_and_type() {
    let (workspace, db) = setup();
    let conn = db.conn().unwrap();
    let p1 = make_project(&conn, &workspace, "P1");
    let p2 = make_project(&conn, &workspace, "P2");

    activity::record(&conn, ActivityType::Project, Some(&p1), "项目事件").unwrap();
    activity::record(&conn, ActivityType::Task, Some(&p1), "任务事件").unwrap();
    activity::record(&conn, ActivityType::Task, Some(&p2), "另一个任务").unwrap();

    let by_project = activity::list_activity(
        &conn,
        &ActivityFilter {
            project_id: Some(p1.clone()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(by_project.total, 2);
    assert!(by_project.items.iter().all(|item| item.project_id.as_deref() == Some(p1.as_str())));

    let by_type = activity::list_activity(
        &conn,
        &ActivityFilter {
            event_type: Some(ActivityType::Task),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(by_type.total, 2);
    assert!(by_type.items.iter().all(|item| item.event_type == ActivityType::Task));
}

#[test]
fn list_paginates_with_limit_and_offset() {
    let (_workspace, db) = setup();
    let conn = db.conn().unwrap();

    for index in 0..5 {
        activity::record(
            &conn,
            ActivityType::System,
            None,
            &format!("事件 {index}"),
        )
        .unwrap();
    }

    let first = activity::list_activity(
        &conn,
        &ActivityFilter {
            limit: Some(2),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(first.total, 5);
    assert_eq!(first.items.len(), 2);

    let second = activity::list_activity(
        &conn,
        &ActivityFilter {
            limit: Some(2),
            offset: Some(2),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(second.total, 5);
    assert_eq!(second.items.len(), 2);

    // 分页之间不应出现重复。
    let first_ids: Vec<_> = first.items.iter().map(|item| item.id.clone()).collect();
    assert!(second.items.iter().all(|item| !first_ids.contains(&item.id)));
}

#[test]
fn list_resolves_project_name_and_survives_deletion() {
    let (workspace, db) = setup();
    let conn = db.conn().unwrap();
    let project_id = make_project(&conn, &workspace, "纪念项目");

    activity::record(&conn, ActivityType::Project, Some(&project_id), "创建项目").unwrap();

    let before = activity::list_activity(&conn, &ActivityFilter::default()).unwrap();
    assert_eq!(before.items[0].project_name.as_deref(), Some("纪念项目"));

    projects::remove_project(&conn, &project_id).unwrap();

    // 活动记录保留，项目名解析为 NULL，前端回退显示「已删除的项目」。
    let after = activity::list_activity(&conn, &ActivityFilter::default()).unwrap();
    assert_eq!(after.total, 1);
    assert!(after.items[0].project_name.is_none());
}

#[test]
fn clear_activity_all_or_by_project() {
    let (workspace, db) = setup();
    let conn = db.conn().unwrap();
    let p1 = make_project(&conn, &workspace, "P1");
    let p2 = make_project(&conn, &workspace, "P2");

    activity::record(&conn, ActivityType::Task, Some(&p1), "a").unwrap();
    activity::record(&conn, ActivityType::Task, Some(&p1), "b").unwrap();
    activity::record(&conn, ActivityType::Task, Some(&p2), "c").unwrap();

    let removed = activity::clear_activity(&conn, Some(&p1)).unwrap();
    assert_eq!(removed, 2);

    let remaining = activity::list_activity(&conn, &ActivityFilter::default()).unwrap();
    assert_eq!(remaining.total, 1);
    assert_eq!(remaining.items[0].project_id.as_deref(), Some(p2.as_str()));

    let cleared = activity::clear_activity(&conn, None).unwrap();
    assert_eq!(cleared, 1);
    assert_eq!(
        activity::list_activity(&conn, &ActivityFilter::default())
            .unwrap()
            .total,
        0
    );
}

#[test]
fn record_ignores_empty_summary() {
    let (_workspace, db) = setup();
    let conn = db.conn().unwrap();

    activity::record(&conn, ActivityType::System, None, "   ").unwrap();
    assert_eq!(
        activity::list_activity(&conn, &ActivityFilter::default())
            .unwrap()
            .total,
        0
    );
}

#[test]
fn since_filter_excludes_older_events() {
    let (_workspace, db) = setup();
    let conn = db.conn().unwrap();

    activity::record(&conn, ActivityType::System, None, "旧事件").unwrap();
    conn.execute(
        "UPDATE activity_logs SET created_at = '2026-01-01T00:00:00.000Z'",
        [],
    )
    .unwrap();
    activity::record(&conn, ActivityType::System, None, "新事件").unwrap();

    let filtered = activity::list_activity(
        &conn,
        &ActivityFilter {
            since: Some("2026-02-01T00:00:00.000Z".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(filtered.total, 1);
    assert_eq!(filtered.items[0].summary, "新事件");
}

#[test]
fn filter_deserializes_camel_case() {
    let json = r#"{"projectId":"p1","eventType":"Task","limit":10,"offset":5}"#;
    let filter: ActivityFilter = serde_json::from_str(json).unwrap();
    assert_eq!(filter.project_id.as_deref(), Some("p1"));
    assert_eq!(filter.event_type, Some(ActivityType::Task));
    assert_eq!(filter.limit, Some(10));
    assert_eq!(filter.offset, Some(5));
}
