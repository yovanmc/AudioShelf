fn main() {
    // Emit a rerun directive for the frontend dist so Cargo rebuilds
    // the binary whenever the frontend assets change.
    println!("cargo:rerun-if-changed=../dist");
    tauri_build::build();
}
