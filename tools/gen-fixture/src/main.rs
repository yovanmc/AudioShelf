use std::path::PathBuf;

fn main() {
    let mut args = std::env::args().skip(1);
    let out = args.next().expect("usage: gen-fixture <output-dir> [--scale AUTHORS WORKS_PER CHAPTERS_PER]");
    let out = PathBuf::from(out);

    match args.next().as_deref() {
        Some("--scale") => {
            let authors: u32 = args.next().expect("AUTHORS").parse().expect("AUTHORS int");
            let works_per: u32 = args.next().expect("WORKS_PER").parse().expect("WORKS_PER int");
            let chapters_per: u32 = args.next().expect("CHAPTERS_PER").parse().expect("CHAPTERS_PER int");
            gen_fixture::generate_scaled(&out, authors, works_per, chapters_per).expect("generate scaled fixture");
            eprintln!("scaled fixture: {authors} authors x {works_per} works x {chapters_per} chapters");
        }
        _ => {
            gen_fixture::generate(&out).expect("generate fixture");
        }
    }
}
