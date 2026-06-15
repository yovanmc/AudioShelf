mod backup;
mod capture;
mod commands;
mod covers;
mod db;
mod grouping;
mod insights;
mod launch;
mod model;
mod natsort;
mod metadata;
mod query;
mod regroup;
mod scoped;
mod rename;
mod scan;

use commands::{DbPathState, DbState};
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
            let db_path = commands::resolve_db_path(&handle);
            let conn = commands::init_db(&handle);
            app.manage(DbState(Mutex::new(conn)));
            app.manage(DbPathState(db_path));
            app.manage(commands::ScanControl(std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false))));
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
            commands::cancel_scan,
            commands::get_setting,
            commands::set_setting,
            commands::get_authors,
            commands::get_author_detail,
            commands::set_chapter_played,
            commands::mark_chapter_finished,
            commands::save_playback_position,
            commands::set_author_display_name,
            commands::get_all_tags,
            commands::set_author_tags,
            commands::set_work_tags,
            commands::set_chapter_tags,
            commands::set_chapter_summary,
            commands::set_chapter_takeaway,
            commands::set_chapter_favorite,
            commands::set_work_re_entry_note,
            commands::set_work_rating,
            commands::get_discovery,
            commands::get_discovery_by_tags,
            commands::get_more_from_author,
            commands::query_home,
            commands::query_insights,
            commands::preview_renames,
            commands::apply_renames,
            commands::undo_renames,
            commands::set_grouping_override,
            commands::clear_grouping_override,
            commands::search_library,
            commands::get_work_cover,
            commands::get_author_cover,
            commands::reset_play_history,
            commands::seed_play_events,
            commands::list_tags_with_counts,
            commands::rename_tag,
            commands::merge_tags,
            commands::set_tag_alias,
            commands::clear_tag_alias,
            commands::set_tag_parent,
            commands::clear_tag_parent,
            commands::preview_metadata,
            commands::apply_metadata,
            commands::detect_series,
            commands::apply_series,
            commands::get_author_series,
            commands::get_dormant_works,
            commands::get_more_like_this,
            commands::suggest_tags,
            commands::get_chapter_journal,
            commands::add_chapter_note,
            commands::delete_chapter_note,
            commands::add_bookmark,
            commands::delete_bookmark,
            commands::query_journal,
            commands::export_journal,
            commands::export_recap_png,
            commands::advanced_search,
            commands::create_saved_search,
            commands::list_saved_searches,
            commands::delete_saved_search,
            commands::create_collection,
            commands::list_collections,
            commands::update_collection,
            commands::delete_collection,
            commands::reorder_collections,
            commands::resolve_collection,
            commands::bulk_set_work_tags,
            commands::set_work_chapter_sort,
            commands::library_health_scan,
            commands::export_curation_json,
            commands::export_db_snapshot,
            commands::import_curation_json,
            commands::stage_db_restore,
            commands::open_mini_player,
            commands::close_mini_player,
            commands::create_metadata_term,
            commands::list_metadata_terms,
            commands::rename_metadata_term,
            commands::delete_metadata_term,
            commands::merge_metadata_terms,
            commands::add_metadata_value,
            commands::remove_metadata_value,
            commands::get_discovery_by_metadata,
            commands::list_label_types,
            commands::create_label_type,
            commands::rename_label_type,
            commands::delete_label_type,
            commands::reorder_label_types,
            commands::query_played_in_range
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Exposed for integration tests.
pub mod testing {
    pub use crate::backup::{apply_curation_import, apply_pending_restore, build_curation_export, stage_db_restore};
    pub use crate::commands::{apply_metadata_proposals, apply_series_proposals, build_metadata_proposals, detect_series_for_author, query_author_detail, query_author_series, query_authors, query_dormant_works, more_like_this, suggest_tags_from, search_library_for_test, SeriesMemberProposal, SeriesProposal, SeriesView};
    pub use crate::covers::{
        cover_cache_for_chapter, find_folder_image, make_thumbnail_png, read_embedded_picture,
        CoverPriority,
    };
    pub use crate::db::{open_at_version, open_in_memory};
    pub use crate::insights::{build_insights, civil_from_days, compute_insights, longest_run, weekday_of, Ev, WorkAgg};
    pub use crate::model::{MetadataApplyReport, MetadataProposal};
    pub use crate::regroup::regroup_author;
    pub use crate::rename::{build_plan, execute, undo, ItemStatus};
    pub use crate::query::{parse_query, CmpOp, DurationFilter, ParsedQuery, StatusFilter};
    pub use crate::scan::scan_into;
    pub use crate::scoped::run_scoped_query;
}
