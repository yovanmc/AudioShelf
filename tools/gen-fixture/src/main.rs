use std::path::PathBuf;

fn main() {
    let out = std::env::args().nth(1).expect("usage: gen-fixture <output-dir>");
    gen_fixture::generate(&PathBuf::from(out)).expect("generate fixture");
}
