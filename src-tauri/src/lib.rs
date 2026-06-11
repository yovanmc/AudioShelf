mod db;
mod model;
mod natsort;
mod grouping;

pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
