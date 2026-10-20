//! 会话数据模型的集成测试。
//!
//! 覆盖：项目 × 工具关联的建立与唯一性、同一组合下的多会话、显示名称可重复、
//! 原生会话 ID 的唯一性与隔离、会话过滤、重命名 / 归档 / 最近使用、工作目录校验、
//! 以及删除项目 / 工具 / 关联时的级联规则。所有情况下都不触碰工具内部数据。

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use vibeacross_lib::db::Database;
use vibeacross_lib::native_claims;
use vibeacross_lib::project_tools;
use vibeacross_lib::projects;
use vibeacross_lib::sessions::{self, SessionInput, SessionQuery, SessionStatus};
use vibeacross_lib::tools::detect::{DetectError, Detector, RegistryInstall, VersionOutcome};
use vibeacross_lib::tools::model::ToolConfigInput;
use vibeacross_lib::tools::service as tools;

/// 只判断「文件是否存在」的检测器（用于登记工具）。
#[derive(Default)]
struct StubDetector {
    files: HashSet<String>,
}

impl StubDetector {
    fn new() -> Self {
        Self::default()
    }

    fn with_file(mut self, path: &str) -> Self {
        self.files.insert(normalize(path));
        self
    }
}

fn normalize(path: &str) -> String {
    path.trim()
        .trim_matches('"')
        .replace('/', "\\")
        .to_ascii_lowercase()
}

impl Detector for StubDetector {
    fn file_exists(&self, path: &Path) -> Result<bool, DetectError> {
        Ok(self.files.contains(&normalize(&path.to_string_lossy())))
    }

    fn resolve_command(&self, _name: &str) -> Option<PathBuf> {
        None
    }

    fn registry_installs(&self, _keywords: &[&str]) -> Vec<RegistryInstall> {
        Vec::new()
    }

    fn app_path(&self, _exe_name: &str) -> Option<PathBuf> {
        None
    }

    fn query_version(&self, _executable: &Path, _args: &[&str]) -> VersionOutcome {
        VersionOutcome::Unsupported
    }
}

fn memory_db() -> Database {
    Database::open_in_memory().expect("创建内存数据库失败")
}

fn stub_exe(dir: &Path, name: &str) -> String {
    let path = dir.join(name);
    std::fs::write(&path, b"stub").unwrap();
    path.to_string_lossy().into_owned()
}

fn tool_input(tool_id: &str, path: &str) -> ToolConfigInput {
    ToolConfigInput {
        tool_id: Some(tool_id.to_string()),
        name: None,
        tool_type: None,
        executable_path: Some(path.to_string()),
        command_name: None,
    }
}

/// 登记工具并返回安装配置 id。
fn add_tool(
    conn: &rusqlite::Connection,
    detector: &dyn Detector,
    input: ToolConfigInput,
) -> String {
    let tool_id = input.tool_id.clone();
    tools::add_tool(conn, detector, input).unwrap();
    tools::tool_state(conn, detector)
        .unwrap()
        .entries
        .iter()
        .find(|entry| {
            entry.source != "builtin"
                && tool_id
                    .as_deref()
                    .map(|id| entry.tool_id == id)
                    .unwrap_or(false)
        })
        .map(|entry| entry.id.clone())
        .expect("未找到刚登记的工具")
}

fn import_project(conn: &rusqlite::Connection, dir: &Path) -> String {
    projects::import_project(conn, dir.to_str().unwrap(), None)
        .unwrap()
        .id
}

fn make_dir(parent: &Path, name: &str) -> PathBuf {
    let dir = parent.join(name);
    std::fs::create_dir(&dir).unwrap();
    dir
}

fn session_input(project_id: &str, tool_id: &str, name: &str) -> SessionInput {
    SessionInput {
        project_id: project_id.to_string(),
        tool_id: tool_id.to_string(),
        display_name: name.to_string(),
        native_session_id: None,
        working_directory: None,
    }
}

#[test]
fn create_session_persists_and_survives_reopen() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = make_dir(workspace.path(), "proj");
    let exe = stub_exe(workspace.path(), "Cursor.exe");
    let detector = StubDetector::new().with_file(&exe);
    let db_path = workspace.path().join("data").join("vibeacross.db");

    let session_id = {
        let db = Database::open(db_path.clone()).unwrap();
        let conn = db.conn().unwrap();
        let project_id = import_project(&conn, &project_dir);
        let tool_id = add_tool(&conn, &detector, tool_input("cursor", &exe));

        let session = sessions::create(
            &conn,
            SessionInput {
                project_id: project_id.clone(),
                tool_id: tool_id.clone(),
                display_name: "  实现登录  ".to_string(),
                native_session_id: Some("native-1".to_string()),
                working_directory: None,
            },
        )
        .unwrap();
        assert_eq!(session.display_name, "实现登录");
        assert_eq!(session.status, SessionStatus::Active);
        assert_eq!(session.project_id, project_id);
        assert_eq!(session.tool_id, tool_id);
        assert_eq!(session.native_session_id.as_deref(), Some("native-1"));
        assert!(session.project_path_exists);
        assert!(session.created_at == session.updated_at);
        session.id
    };

    // 重新打开数据库（模拟应用重启）。
    let db = Database::open(db_path).unwrap();
    let conn = db.conn().unwrap();
    let reloaded = sessions::get(&conn, &session_id).unwrap();
    assert_eq!(reloaded.display_name, "实现登录");
    assert_eq!(reloaded.native_session_id.as_deref(), Some("native-1"));
}

#[test]
fn create_establishes_association_automatically() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let exe = stub_exe(workspace.path(), "Cursor.exe");
    let detector = StubDetector::new().with_file(&exe);
    let project_dir = make_dir(workspace.path(), "proj");
    let project_id = import_project(&conn, &project_dir);
    let tool_id = add_tool(&conn, &detector, tool_input("cursor", &exe));

    assert!(project_tools::list_for_project(&conn, &project_id)
        .unwrap()
        .is_empty());

    let session = sessions::create(&conn, session_input(&project_id, &tool_id, "首次会话")).unwrap();

    let associations = project_tools::list_for_project(&conn, &project_id).unwrap();
    assert_eq!(associations.len(), 1);
    assert_eq!(associations[0].id, session.project_tool_id);
    assert_eq!(associations[0].session_count, 1);
}

#[test]
fn one_project_links_many_tools_and_one_tool_many_projects() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let cursor = stub_exe(workspace.path(), "Cursor.exe");
    let trae = stub_exe(workspace.path(), "Trae.exe");
    let detector = StubDetector::new().with_file(&cursor).with_file(&trae);

    let project_a = import_project(&conn, &make_dir(workspace.path(), "a"));
    let project_b = import_project(&conn, &make_dir(workspace.path(), "b"));
    let cursor_id = add_tool(&conn, &detector, tool_input("cursor", &cursor));
    let trae_id = add_tool(&conn, &detector, tool_input("trae", &trae));

    let a_cursor = project_tools::ensure(&conn, &project_a, &cursor_id).unwrap();
    let a_trae = project_tools::ensure(&conn, &project_a, &trae_id).unwrap();
    let b_cursor = project_tools::ensure(&conn, &project_b, &cursor_id).unwrap();

    assert_eq!(project_tools::list_for_project(&conn, &project_a).unwrap().len(), 2);
    assert_eq!(project_tools::list_for_tool(&conn, &cursor_id).unwrap().len(), 2);

    // 重复建立同一关联是幂等的，返回同一条记录。
    assert_eq!(project_tools::ensure(&conn, &project_a, &cursor_id).unwrap().id, a_cursor.id);
    assert_ne!(a_cursor.id, a_trae.id);
    assert_ne!(a_cursor.id, b_cursor.id);

    // 关联必须指向存在的项目与工具。
    let bad_project = project_tools::ensure(&conn, "ghost", &cursor_id).unwrap_err();
    assert_eq!(bad_project.code, "PROJECT_NOT_FOUND");
    let bad_tool = project_tools::ensure(&conn, &project_a, "ghost").unwrap_err();
    assert_eq!(bad_tool.code, "TOOL_NOT_FOUND");
}

#[test]
fn multiple_sessions_per_association_allow_duplicate_names() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let exe = stub_exe(workspace.path(), "Cursor.exe");
    let detector = StubDetector::new().with_file(&exe);
    let project_id = import_project(&conn, &make_dir(workspace.path(), "proj"));
    let tool_id = add_tool(&conn, &detector, tool_input("cursor", &exe));

    let first = sessions::create(&conn, session_input(&project_id, &tool_id, "同名会话")).unwrap();
    let second = sessions::create(&conn, session_input(&project_id, &tool_id, "同名会话")).unwrap();
    assert_ne!(first.id, second.id);
    assert_eq!(first.project_tool_id, second.project_tool_id);

    let all = sessions::list(&conn, &SessionQuery::default()).unwrap();
    assert_eq!(all.len(), 2);
}

#[test]
fn native_session_id_is_unique_within_association_only() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let cursor = stub_exe(workspace.path(), "Cursor.exe");
    let trae = stub_exe(workspace.path(), "Trae.exe");
    let detector = StubDetector::new().with_file(&cursor).with_file(&trae);
    let project_id = import_project(&conn, &make_dir(workspace.path(), "proj"));
    let cursor_id = add_tool(&conn, &detector, tool_input("cursor", &cursor));
    let trae_id = add_tool(&conn, &detector, tool_input("trae", &trae));

    let mut with_native = session_input(&project_id, &cursor_id, "会话 A");
    with_native.native_session_id = Some("shared-native".to_string());
    sessions::create(&conn, with_native).unwrap();

    // 同一项目工具关联下重复的原生会话 ID 被拒绝。
    let duplicate = sessions::create(
        &conn,
        SessionInput {
            project_id: project_id.clone(),
            tool_id: cursor_id.clone(),
            display_name: "会话 B".to_string(),
            native_session_id: Some("shared-native".to_string()),
            working_directory: None,
        },
    )
    .unwrap_err();
    assert_eq!(duplicate.code, "SESSION_NATIVE_ID_DUPLICATE");

    // 同一原生 ID 关联到「另一个工具」的会话是允许的。
    let other_tool = sessions::create(
        &conn,
        SessionInput {
            project_id: project_id.clone(),
            tool_id: trae_id,
            display_name: "会话 C".to_string(),
            native_session_id: Some("shared-native".to_string()),
            working_directory: None,
        },
    )
    .unwrap();
    assert_eq!(other_tool.native_session_id.as_deref(), Some("shared-native"));

    // 原生会话 ID 为空时允许多条（每次新的原生会话都没有 ID）。
    sessions::create(&conn, session_input(&project_id, &cursor_id, "无 ID 1")).unwrap();
    sessions::create(&conn, session_input(&project_id, &cursor_id, "无 ID 2")).unwrap();
}

#[test]
fn claim_is_rolled_back_when_native_session_insert_fails() {
    // 归属登记与会话行必须原子写入：登记成功但会话写入失败时，归属必须一并回滚，
    // 否则会残留「已认领却无会话」的记录，永久阻塞该原生会话。
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let exe = stub_exe(workspace.path(), "Cursor.exe");
    let detector = StubDetector::new().with_file(&exe);
    let project_id = import_project(&conn, &make_dir(workspace.path(), "proj"));
    let tool_id = add_tool(&conn, &detector, tool_input("cursor", &exe));
    let association = project_tools::ensure(&conn, &project_id, &tool_id).unwrap();

    // 绕过归属登记，直接制造一条已占用 (关联, 原生 ID) 的会话行。
    conn.execute(
        "INSERT INTO sessions
            (id, project_tool_id, display_name, native_session_id, status, created_at, updated_at)
         VALUES ('pre-existing', ?1, '手工会话', 'native-rollback', 'active', 't', 't')",
        rusqlite::params![association.id],
    )
    .unwrap();
    assert!(
        native_claims::owner_project(&conn, "cursor", "native-rollback")
            .unwrap()
            .is_none(),
        "前置条件：该原生会话尚未被认领"
    );

    // 同一 (关联, 原生 ID) 再次写入会撞唯一索引而失败。
    let error = sessions::insert_native(&conn, &association.id, "新会话", "native-rollback", None)
        .unwrap_err();
    assert_eq!(error.code, "SESSION_NATIVE_ID_DUPLICATE");

    // 关键断言：会话写入失败后，归属登记必须一并回滚（不得残留）。
    assert_eq!(
        native_claims::owner_project(&conn, "cursor", "native-rollback").unwrap(),
        None,
        "会话行写入失败后不得残留归属登记"
    );
}

#[test]
fn sessions_are_isolated_per_tool() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let cursor = stub_exe(workspace.path(), "Cursor.exe");
    let trae = stub_exe(workspace.path(), "Trae.exe");
    let detector = StubDetector::new().with_file(&cursor).with_file(&trae);
    let project_id = import_project(&conn, &make_dir(workspace.path(), "proj"));
    let cursor_id = add_tool(&conn, &detector, tool_input("cursor", &cursor));
    let trae_id = add_tool(&conn, &detector, tool_input("trae", &trae));

    let cursor_session =
        sessions::create(&conn, session_input(&project_id, &cursor_id, "Cursor 会话")).unwrap();
    sessions::create(&conn, session_input(&project_id, &trae_id, "Trae 会话")).unwrap();

    let cursor_only = sessions::list(
        &conn,
        &SessionQuery {
            project_id: Some(project_id.clone()),
            tool_id: Some(cursor_id.clone()),
            status: None,
        },
    )
    .unwrap();
    assert_eq!(cursor_only.len(), 1);
    assert_eq!(cursor_only[0].id, cursor_session.id);
    assert_eq!(cursor_only[0].tool_id, cursor_id);
}

#[test]
fn rename_status_and_touch_update_session() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let exe = stub_exe(workspace.path(), "Cursor.exe");
    let detector = StubDetector::new().with_file(&exe);
    let project_id = import_project(&conn, &make_dir(workspace.path(), "proj"));
    let tool_id = add_tool(&conn, &detector, tool_input("cursor", &exe));

    let session = sessions::create(&conn, session_input(&project_id, &tool_id, "旧名称")).unwrap();
    assert!(session.last_used_at.is_none());

    let renamed = sessions::rename(&conn, &session.id, "  新名称  ").unwrap();
    assert_eq!(renamed.display_name, "新名称");

    let empty = sessions::rename(&conn, &session.id, "   ").unwrap_err();
    assert_eq!(empty.code, "SESSION_NAME_EMPTY");

    let archived = sessions::set_status(&conn, &session.id, SessionStatus::Archived).unwrap();
    assert_eq!(archived.status, SessionStatus::Archived);
    let active_only = sessions::list(
        &conn,
        &SessionQuery {
            project_id: None,
            tool_id: None,
            status: Some(SessionStatus::Active),
        },
    )
    .unwrap();
    assert!(active_only.is_empty());

    // `nativeDeleted` 是删除流程写入的只读状态，不能由普通状态接口伪造。
    let rejected =
        sessions::set_status(&conn, &session.id, SessionStatus::NativeDeleted).unwrap_err();
    assert_eq!(rejected.code, "SESSION_STATUS_INVALID");
    let marked = sessions::mark_native_deleted(&conn, &session.id).unwrap();
    assert_eq!(marked.status, SessionStatus::NativeDeleted);

    let touched = sessions::touch(&conn, &session.id).unwrap();
    assert!(touched.last_used_at.is_some());

    // 最近使用的会话排在列表最前。
    let extra = sessions::create(&conn, session_input(&project_id, &tool_id, "另一会话")).unwrap();
    let ordered = sessions::list(&conn, &SessionQuery::default()).unwrap();
    assert_eq!(ordered[0].id, session.id, "最近使用的会话应排在最前");
    assert!(ordered.iter().any(|item| item.id == extra.id));
}

#[test]
fn create_validates_project_tool_and_name() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let exe = stub_exe(workspace.path(), "Cursor.exe");
    let detector = StubDetector::new().with_file(&exe);
    let project_id = import_project(&conn, &make_dir(workspace.path(), "proj"));
    let tool_id = add_tool(&conn, &detector, tool_input("cursor", &exe));

    let missing_project = sessions::create(
        &conn,
        session_input("nope", &tool_id, "会话"),
    )
    .unwrap_err();
    assert_eq!(missing_project.code, "PROJECT_NOT_FOUND");

    let missing_tool = sessions::create(
        &conn,
        session_input(&project_id, "ghost", "会话"),
    )
    .unwrap_err();
    assert_eq!(missing_tool.code, "TOOL_NOT_FOUND");

    let empty_name = sessions::create(
        &conn,
        session_input(&project_id, &tool_id, "   "),
    )
    .unwrap_err();
    assert_eq!(empty_name.code, "SESSION_NAME_EMPTY");

    let long_name = sessions::create(
        &conn,
        session_input(&project_id, &tool_id, &"x".repeat(200)),
    )
    .unwrap_err();
    assert_eq!(long_name.code, "SESSION_NAME_TOO_LONG");

    // 校验失败不应留下任何关联或会话。
    assert!(project_tools::list_for_project(&conn, &project_id).unwrap().is_empty());
}

#[test]
fn working_directory_must_be_inside_project() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let exe = stub_exe(workspace.path(), "Cursor.exe");
    let detector = StubDetector::new().with_file(&exe);
    let project_dir = make_dir(workspace.path(), "proj");
    let project_id = import_project(&conn, &project_dir);
    let tool_id = add_tool(&conn, &detector, tool_input("cursor", &exe));

    // 项目内的子目录可用。
    let sub = make_dir(&project_dir, "src");
    let inside = sessions::create(
        &conn,
        SessionInput {
            project_id: project_id.clone(),
            tool_id: tool_id.clone(),
            display_name: "子目录会话".to_string(),
            native_session_id: None,
            working_directory: Some(sub.to_string_lossy().into_owned()),
        },
    )
    .unwrap();
    assert!(inside.working_directory.as_deref().unwrap().to_ascii_lowercase().ends_with("src"));

    // 项目之外的目录被拒绝。
    let outside = make_dir(workspace.path(), "elsewhere");
    let rejected = sessions::create(
        &conn,
        SessionInput {
            project_id,
            tool_id,
            display_name: "越界会话".to_string(),
            native_session_id: None,
            working_directory: Some(outside.to_string_lossy().into_owned()),
        },
    )
    .unwrap_err();
    assert_eq!(rejected.code, "SESSION_DIR_OUTSIDE_PROJECT");
}

#[test]
fn delete_session_removes_only_that_record() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let exe = stub_exe(workspace.path(), "Cursor.exe");
    let detector = StubDetector::new().with_file(&exe);
    let project_id = import_project(&conn, &make_dir(workspace.path(), "proj"));
    let tool_id = add_tool(&conn, &detector, tool_input("cursor", &exe));

    let first = sessions::create(&conn, session_input(&project_id, &tool_id, "会话 1")).unwrap();
    let second = sessions::create(&conn, session_input(&project_id, &tool_id, "会话 2")).unwrap();

    sessions::delete(&conn, &first.id).unwrap();
    assert!(sessions::get(&conn, &first.id).is_err());
    assert_eq!(sessions::get(&conn, &second.id).unwrap().id, second.id);

    let missing = sessions::delete(&conn, &first.id).unwrap_err();
    assert_eq!(missing.code, "SESSION_NOT_FOUND");
}

#[test]
fn removing_project_cascades_associations_and_sessions() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let exe = stub_exe(workspace.path(), "Cursor.exe");
    let detector = StubDetector::new().with_file(&exe);
    let project_id = import_project(&conn, &make_dir(workspace.path(), "proj"));
    let tool_id = add_tool(&conn, &detector, tool_input("cursor", &exe));

    let session = sessions::create(&conn, session_input(&project_id, &tool_id, "会话")).unwrap();
    projects::remove_project(&conn, &project_id).unwrap();

    assert!(sessions::get(&conn, &session.id).is_err());
    assert!(project_tools::list_for_project(&conn, &project_id).unwrap().is_empty());
    assert!(sessions::list(&conn, &SessionQuery::default()).unwrap().is_empty());
}

#[test]
fn removing_tool_cascades_associations_and_sessions() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let exe = stub_exe(workspace.path(), "Cursor.exe");
    let detector = StubDetector::new().with_file(&exe);
    let project_id = import_project(&conn, &make_dir(workspace.path(), "proj"));
    let tool_id = add_tool(&conn, &detector, tool_input("cursor", &exe));

    let session = sessions::create(&conn, session_input(&project_id, &tool_id, "会话")).unwrap();
    tools::remove_tool(&conn, &tool_id).unwrap();

    assert!(sessions::get(&conn, &session.id).is_err());
    assert!(project_tools::list_for_tool(&conn, &tool_id).unwrap().is_empty());
    // 项目本身仍然存在。
    assert!(projects::get_project(&conn, &project_id).is_ok());
}

#[test]
fn removing_project_tool_cascades_only_its_sessions() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let cursor = stub_exe(workspace.path(), "Cursor.exe");
    let trae = stub_exe(workspace.path(), "Trae.exe");
    let detector = StubDetector::new().with_file(&cursor).with_file(&trae);
    let project_id = import_project(&conn, &make_dir(workspace.path(), "proj"));
    let cursor_id = add_tool(&conn, &detector, tool_input("cursor", &cursor));
    let trae_id = add_tool(&conn, &detector, tool_input("trae", &trae));

    let cursor_session =
        sessions::create(&conn, session_input(&project_id, &cursor_id, "Cursor 会话")).unwrap();
    sessions::create(&conn, session_input(&project_id, &trae_id, "Trae 会话")).unwrap();

    let association = project_tools::find(&conn, &project_id, &cursor_id)
        .unwrap()
        .expect("应存在关联");
    project_tools::remove(&conn, &association.id).unwrap();

    assert!(sessions::get(&conn, &cursor_session.id).is_err());
    // 另一款工具的关联与会话不受影响。
    let remaining = sessions::list(&conn, &SessionQuery::default()).unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].tool_id, trae_id);
}
