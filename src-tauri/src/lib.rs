mod capture;
mod commands;
mod db;
mod grouping;
mod launch;
mod model;
mod natsort;
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
        .manage(args)
        .setup(|app| {
            let conn = commands::init_db(&app.handle());
            app.manage(DbState(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_launch_args,
            capture::capture_window,
            capture::finish_walkthrough,
            commands::scan_library,
            commands::get_authors,
            commands::get_author_detail,
            commands::set_chapter_played,
            commands::mark_chapter_finished,
            commands::set_author_display_name,
            commands::get_all_tags,
            commands::set_author_tags,
            commands::get_discovery,
            commands::get_discovery_by_tags,
            commands::get_more_from_author
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Exposed for integration tests.
pub mod testing {
    pub use crate::commands::{query_author_detail, query_authors};
    pub use crate::db::open_in_memory;
    pub use crate::scan::scan_into;
}
