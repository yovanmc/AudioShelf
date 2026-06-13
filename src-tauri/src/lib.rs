mod capture;
mod commands;
mod covers;
mod db;
mod grouping;
mod launch;
mod model;
mod natsort;
mod regroup;
mod rename;
mod scan;

use commands::DbState;
use launch::LaunchArgs;
use std::sync::Mutex;
use tauri::Manager;

#[tauri::command]
fn get_launch_args(state: tauri::State<LaunchArgs>) -> LaunchArgs {
    state.inner().clone()
}

pub fn run() {
    let args = LaunchArgs::parse_lenient(std::env::args());
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(args)
        .setup(|app| {
            let handle = app.handle();
            let conn = commands::init_db(&handle);
            app.manage(DbState(Mutex::new(conn)));
            // Cover thumbnails are cached here and served via the asset protocol.
            let covers_dir = handle
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir())
                .join("covers");
            std::fs::create_dir_all(&covers_dir).ok();
            let _ = handle.asset_protocol_scope().allow_directory(&covers_dir, true);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_launch_args,
            capture::capture_window,
            capture::finish_walkthrough,
            commands::scan_library,
            commands::get_setting,
            commands::set_setting,
            commands::get_authors,
            commands::get_author_detail,
            commands::set_chapter_played,
            commands::mark_chapter_finished,
            commands::set_author_display_name,
            commands::get_all_tags,
            commands::set_author_tags,
            commands::set_work_tags,
            commands::set_chapter_tags,
            commands::get_discovery,
            commands::get_discovery_by_tags,
            commands::get_more_from_author,
            commands::query_home,
            commands::preview_renames,
            commands::apply_renames,
            commands::undo_renames,
            commands::set_grouping_override,
            commands::clear_grouping_override,
            commands::search_library,
            commands::get_work_cover,
            commands::get_author_cover,
            commands::reset_play_history,
            commands::list_tags_with_counts,
            commands::rename_tag,
            commands::merge_tags,
            commands::set_tag_alias,
            commands::clear_tag_alias,
            commands::set_tag_parent,
            commands::clear_tag_parent
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Exposed for integration tests.
pub mod testing {
    pub use crate::commands::{query_author_detail, query_authors};
    pub use crate::covers::{
        cover_cache_for_chapter, find_folder_image, make_thumbnail_png, read_embedded_picture,
        CoverPriority,
    };
    pub use crate::db::{open_at_version, open_in_memory};
    pub use crate::regroup::regroup_author;
    pub use crate::rename::{build_plan, execute, undo, ItemStatus};
    pub use crate::scan::scan_into;
}
