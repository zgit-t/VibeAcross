use tempfile::TempDir;
use vibeacross_lib::db::Database;
use vibeacross_lib::projects;
use vibeacross_lib::tasks::{self, TaskInput, TaskPriority, TaskQuery, TaskStatus};

fn setup() -> (TempDir, Database) {
    let workspace = tempfile::tempdir().expect("创建临时目录失败");
    let db = Database::open_in_memory().unwrap();
    (workspace, db)
}

fn make_project(conn: &rusqlite::Connection, workspace: &TempDir, name: &str) -> String {
    let project =
        projects::create_project(conn, name, &workspace.path().to_string_lossy()).unwrap();
    project.id
}

fn input(project_id: &str, title: &str) -> TaskInput {
    TaskInput {
        project_id: project_id.to_string(),
        title: title.to_string(),
        description: None,
        status: None,
        priority: TaskPriority::Medium,
        due_date: None,
    }
}

#[test]
fn create_task_applies_defaults() {
    let (workspace, db) = setup();
    let conn = db.conn().unwrap();
    let project_id = make_project(&conn, &workspace, "P1");

    let task = tasks::create_task(&conn, input(&project_id, "  写文档  ")).unwrap();

    assert_eq!(task.title, "写文档", "标题应去除首尾空白");
    assert_eq!(task.project_id, project_id);
    assert_eq!(task.status, TaskStatus::Todo);
    assert_eq!(task.priority, TaskPriority::Medium);
    assert!(task.description.is_none());
    assert!(task.due_date.is_none());
    assert!(task.completed_at.is_none());
    assert_eq!(task.created_at, task.updated_at);
}

#[test]
fn create_task_requires_valid_project() {
    let (_workspace, db) = setup();
    let conn = db.conn().unwrap();

    let missing = tasks::create_task(&conn, input("no-such-project", "x")).unwrap_err();
    assert_eq!(missing.code, "PROJECT_NOT_FOUND");

    let empty = tasks::create_task(&conn, input("  ", "x")).unwrap_err();
    assert_eq!(empty.code, "TASK_PROJECT_REQUIRED");
}

#[test]
fn create_task_validates_title() {
    let (workspace, db) = setup();
    let conn = db.conn().unwrap();
    let project_id = make_project(&conn, &workspace, "P1");

    let empty = tasks::create_task(&conn, input(&project_id, "   ")).unwrap_err();
    assert_eq!(empty.code, "TASK_TITLE_EMPTY");

    let long = tasks::create_task(&conn, input(&project_id, &"字".repeat(201))).unwrap_err();
    assert_eq!(long.code, "TASK_TITLE_TOO_LONG");
}

#[test]
fn create_task_validates_and_stores_due_date() {
    let (workspace, db) = setup();
    let conn = db.conn().unwrap();
    let project_id = make_project(&conn, &workspace, "P1");

    let mut with_date = input(&project_id, "任务");
    with_date.due_date = Some("2026-12-31".into());
    let task = tasks::create_task(&conn, with_date).unwrap();
    assert_eq!(task.due_date.as_deref(), Some("2026-12-31"));

    let mut invalid = input(&project_id, "任务");
    invalid.due_date = Some("2026/12/31".into());
    let error = tasks::create_task(&conn, invalid).unwrap_err();
    assert_eq!(error.code, "TASK_DUE_DATE_INVALID");

    // 空白日期视为未设置。
    let mut blank = input(&project_id, "任务");
    blank.due_date = Some("   ".into());
    let task = tasks::create_task(&conn, blank).unwrap();
    assert!(task.due_date.is_none());
}

#[test]
fn create_task_as_done_records_completion_time() {
    let (workspace, db) = setup();
    let conn = db.conn().unwrap();
    let project_id = make_project(&conn, &workspace, "P1");

    let mut done = input(&project_id, "已完成任务");
    done.status = Some(TaskStatus::Done);
    let task = tasks::create_task(&conn, done).unwrap();

    assert_eq!(task.status, TaskStatus::Done);
    assert!(task.completed_at.is_some());
    assert_eq!(task.completed_at.as_deref(), Some(task.created_at.as_str()));
}

#[test]
fn update_task_preserves_status_when_omitted() {
    let (workspace, db) = setup();
    let conn = db.conn().unwrap();
    let project_id = make_project(&conn, &workspace, "P1");

    let created = tasks::create_task(&conn, input(&project_id, "原标题")).unwrap();
    tasks::set_task_status(&conn, &created.id, TaskStatus::InProgress).unwrap();

    let mut update = input(&project_id, "新标题");
    update.description = Some("  说明  ".into());
    update.priority = TaskPriority::High;
    update.due_date = Some("2026-01-02".into());
    // status 省略，应保留 inProgress。
    let updated = tasks::update_task(&conn, &created.id, update).unwrap();

    assert_eq!(updated.title, "新标题");
    assert_eq!(updated.description.as_deref(), Some("说明"));
    assert_eq!(updated.priority, TaskPriority::High);
    assert_eq!(updated.due_date.as_deref(), Some("2026-01-02"));
    assert_eq!(updated.status, TaskStatus::InProgress);
    assert!(updated.completed_at.is_none());
}

#[test]
fn complete_and_reopen_toggle_completed_at() {
    let (workspace, db) = setup();
    let conn = db.conn().unwrap();
    let project_id = make_project(&conn, &workspace, "P1");
    let task = tasks::create_task(&conn, input(&project_id, "任务")).unwrap();

    let done = tasks::set_task_status(&conn, &task.id, TaskStatus::Done).unwrap();
    assert_eq!(done.status, TaskStatus::Done);
    assert!(done.completed_at.is_some());

    let reopened = tasks::set_task_status(&conn, &task.id, TaskStatus::Todo).unwrap();
    assert_eq!(reopened.status, TaskStatus::Todo);
    assert!(reopened.completed_at.is_none());
}

#[test]
fn set_task_status_is_idempotent() {
    let (workspace, db) = setup();
    let conn = db.conn().unwrap();
    let project_id = make_project(&conn, &workspace, "P1");
    let task = tasks::create_task(&conn, input(&project_id, "任务")).unwrap();

    // 重复设置相同状态不应改写记录（也避免产生多余的活动记录）。
    let same = tasks::set_task_status(&conn, &task.id, TaskStatus::Todo).unwrap();
    assert_eq!(same.updated_at, task.updated_at);

    let done = tasks::set_task_status(&conn, &task.id, TaskStatus::Done).unwrap();
    let again = tasks::set_task_status(&conn, &done.id, TaskStatus::Done).unwrap();
    assert_eq!(again.completed_at, done.completed_at);
}

#[test]
fn delete_task_removes_record() {
    let (workspace, db) = setup();
    let conn = db.conn().unwrap();
    let project_id = make_project(&conn, &workspace, "P1");
    let task = tasks::create_task(&conn, input(&project_id, "任务")).unwrap();

    tasks::delete_task(&conn, &task.id).unwrap();
    assert_eq!(
        tasks::get_task(&conn, &task.id).unwrap_err().code,
        "TASK_NOT_FOUND"
    );
}

#[test]
fn list_tasks_filters_by_project_status_priority_and_search() {
    let (workspace, db) = setup();
    let conn = db.conn().unwrap();
    let p1 = make_project(&conn, &workspace, "P1");
    let p2 = make_project(&conn, &workspace, "P2");

    let a = tasks::create_task(&conn, input(&p1, "修复登录 login Bug")).unwrap();
    let mut high = input(&p1, "设计首页");
    high.priority = TaskPriority::High;
    let b = tasks::create_task(&conn, high).unwrap();
    let mut done = input(&p2, "写测试");
    done.status = Some(TaskStatus::Done);
    let c = tasks::create_task(&conn, done).unwrap();

    let by_project = tasks::list_tasks(
        &conn,
        &TaskQuery {
            project_id: Some(p1.clone()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(by_project.len(), 2);
    assert!(by_project.iter().all(|task| task.project_id == p1));

    let by_status = tasks::list_tasks(
        &conn,
        &TaskQuery {
            status: Some(TaskStatus::Done),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(by_status.len(), 1);
    assert_eq!(by_status[0].id, c.id);

    let by_priority = tasks::list_tasks(
        &conn,
        &TaskQuery {
            priority: Some(TaskPriority::High),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(by_priority.len(), 1);
    assert_eq!(by_priority[0].id, b.id);

    // 搜索不区分大小写，并匹配描述。
    let search = tasks::list_tasks(
        &conn,
        &TaskQuery {
            search: Some("LOGIN".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(search.len(), 1);
    assert_eq!(search[0].id, a.id);

    let none = tasks::list_tasks(
        &conn,
        &TaskQuery {
            search: Some("不存在的关键字".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(none.is_empty());
}

#[test]
fn list_tasks_search_treats_wildcards_literally() {
    let (workspace, db) = setup();
    let conn = db.conn().unwrap();
    let p1 = make_project(&conn, &workspace, "P1");

    tasks::create_task(&conn, input(&p1, "100% 完成")).unwrap();
    tasks::create_task(&conn, input(&p1, "普通任务")).unwrap();

    let percent = tasks::list_tasks(
        &conn,
        &TaskQuery {
            search: Some("%".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(percent.len(), 1, "百分号应按字面量匹配，而非通配符");
}

#[test]
fn list_tasks_sorts_by_created_or_updated() {
    let (workspace, db) = setup();
    let conn = db.conn().unwrap();
    let p1 = make_project(&conn, &workspace, "P1");

    let first = tasks::create_task(&conn, input(&p1, "第一个")).unwrap();
    let second = tasks::create_task(&conn, input(&p1, "第二个")).unwrap();

    // 手工写入确定的时间戳，避免依赖毫秒级时钟。
    conn.execute(
        "UPDATE tasks SET created_at = '2026-01-01T00:00:00.000Z', updated_at = '2026-03-01T00:00:00.000Z' WHERE id = ?1",
        [&first.id],
    )
    .unwrap();
    conn.execute(
        "UPDATE tasks SET created_at = '2026-02-01T00:00:00.000Z', updated_at = '2026-02-01T00:00:00.000Z' WHERE id = ?1",
        [&second.id],
    )
    .unwrap();

    let by_created = tasks::list_tasks(
        &conn,
        &TaskQuery {
            sort: Some("created".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(by_created[0].id, second.id);

    let by_updated = tasks::list_tasks(&conn, &TaskQuery::default()).unwrap();
    assert_eq!(by_updated[0].id, first.id);
}

#[test]
fn task_stats_counts_by_status() {
    let (workspace, db) = setup();
    let conn = db.conn().unwrap();
    let p1 = make_project(&conn, &workspace, "P1");

    tasks::create_task(&conn, input(&p1, "待办1")).unwrap();
    tasks::create_task(&conn, input(&p1, "待办2")).unwrap();
    let doing = tasks::create_task(&conn, input(&p1, "进行中")).unwrap();
    tasks::set_task_status(&conn, &doing.id, TaskStatus::InProgress).unwrap();
    let finished = tasks::create_task(&conn, input(&p1, "完成")).unwrap();
    tasks::set_task_status(&conn, &finished.id, TaskStatus::Done).unwrap();

    let stats = tasks::task_stats(&conn).unwrap();
    assert_eq!(stats.todo, 2);
    assert_eq!(stats.in_progress, 1);
    assert_eq!(stats.done, 1);
    assert_eq!(stats.total, 4);
}

#[test]
fn removing_project_deletes_its_tasks() {
    let (workspace, db) = setup();
    let conn = db.conn().unwrap();
    let p1 = make_project(&conn, &workspace, "P1");
    let p2 = make_project(&conn, &workspace, "P2");

    let keep = tasks::create_task(&conn, input(&p2, "保留")).unwrap();
    tasks::create_task(&conn, input(&p1, "删除")).unwrap();

    projects::remove_project(&conn, &p1).unwrap();

    let remaining = tasks::list_tasks(&conn, &TaskQuery::default()).unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, keep.id);
}

#[test]
fn task_input_rejects_unknown_status_and_priority() {
    // 前端传入非法枚举值时应无法反序列化为 TaskInput，直接拒绝。
    let bad_status = r#"{"projectId":"p","title":"t","priority":"medium","status":"blocked"}"#;
    assert!(serde_json::from_str::<TaskInput>(bad_status).is_err());

    let bad_priority = r#"{"projectId":"p","title":"t","priority":"urgent"}"#;
    assert!(serde_json::from_str::<TaskInput>(bad_priority).is_err());

    let ok = r#"{"projectId":"p","title":"t","priority":"high","status":"inProgress","dueDate":"2026-05-06"}"#;
    let parsed = serde_json::from_str::<TaskInput>(ok).unwrap();
    assert_eq!(parsed.status, Some(TaskStatus::InProgress));
    assert_eq!(parsed.priority, TaskPriority::High);
    assert_eq!(parsed.due_date.as_deref(), Some("2026-05-06"));
}
